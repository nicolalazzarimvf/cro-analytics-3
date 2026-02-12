import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { callLLM } from "@/lib/ai/client";
import { prisma } from "@/lib/db/client";
import { queryGraphPatterns } from "@/lib/graph/postgres";

type Mode = "auto" | "sql" | "graph";

function isSelectOnly(sql: string) {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith("select")) return false;
  const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate"];
  return !forbidden.some((kw) => trimmed.includes(`${kw} `));
}

function ensureLimit(sql: string, max = 500) {
  const hasLimit = /\blimit\s+\d+/i.test(sql);
  if (hasLimit) return sql;
  return `${sql.trim().replace(/;+\s*$/, "")} LIMIT ${max}`;
}

// Normalize interval syntax like "interval 6 months" -> "interval '6 months'"
function normalizeIntervals(sql: string) {
  return sql.replace(/interval\s+(\d+)\s+months?/gi, `interval '$1 months'`);
}

// Normalize round(column, n) on float columns to cast as numeric for Postgres compatibility.
function normalizeRound(sql: string) {
  // Broadly match round(<expr>, n) and cast to numeric so Postgres accepts two-arg form.
  return sql.replace(/round\(\s*([^,]+?)\s*,\s*(\d+)\s*\)/gi, `round(CAST($1 AS numeric), $2)`);
}

function normalizeVerticalFilter(sql: string) {
  // Rewrite vertical = 'solar_panels' style filters to a loose, case-insensitive match,
  // also converting underscores to spaces to catch "Solar Panels" vs "solar_panels".
  return sql.replace(/\bvertical\s*=\s*'([^']+)'/gi, (_, rawVal: string) => {
    const safeVal = rawVal.replace(/_/g, " ").replace(/'/g, "''").trim();
    return `"vertical" ILIKE '%${safeVal}%'`;
  });
}

function normalizeTableName(sql: string) {
  let result = sql.replace(/(?<!")\bexperiment\b(?!")/gi, `"Experiment"`);
  const columnMap: Record<string, string> = {
    experimentid: `"experimentId"`,
    testname: `"testName"`,
    datelaunched: `"dateLaunched"`,
    dateconcluded: `"dateConcluded"`,
    winningvar: `"winningVar"`,
    monthlyextrap: `"monthlyExtrap"`,
    launchedby: `"launchedBy"`,
    userjourneytype: `"userJourneyType"`,
    targetmetric: `"targetMetric"`,
    monetisationmethod: `"monetisationMethod"`,
    monetizationmethod: `"monetisationMethod"`,
    variationscount: `"variationsCount"`,
    baseurl: `"baseUrl"`,
    mobiletrafficpct: `"mobileTrafficPct"`,
    visitscontrol: `"visitsControl"`,
    visitsvar1: `"visitsVar1"`,
    visitsvar2: `"visitsVar2"`,
    visitsvar3: `"visitsVar3"`,
    totalvisits: `"totalVisits"`,
    primarymetricname: `"primaryMetricName"`,
    primarycontrolconv: `"primaryControlConv"`,
    primaryvar1conv: `"primaryVar1Conv"`,
    primaryvar2conv: `"primaryVar2Conv"`,
    primaryvar3conv: `"primaryVar3Conv"`,
    primarysignificance1: `"primarySignificance1"`,
    secondarymetricname: `"secondaryMetricName"`,
    secondarycontrolconv: `"secondaryControlConv"`,
    secondaryvar1conv: `"secondaryVar1Conv"`,
    secondaryvar2conv: `"secondaryVar2Conv"`,
    secondaryvar3conv: `"secondaryVar3Conv"`,
    tertiarymetricname: `"tertiaryMetricName"`,
    tertiarycontrolconv: `"tertiaryControlConv"`,
    tertiaryvar1conv: `"tertiaryVar1Conv"`,
    tertiaryvar2conv: `"tertiaryVar2Conv"`,
    tertiaryvar3conv: `"tertiaryVar3Conv"`,
    tradinghub: `"tradingHub"`,
    masterlever: `"masterLever"`,
    lever: `"lever"`,
    crchangev1: `"crChangeV1"`,
    crchangev2: `"crChangeV2"`,
    crchangev3: `"crChangeV3"`,
    rpvchangev1: `"rpvChangeV1"`,
    rpvchangev2: `"rpvChangeV2"`,
    rpvchangev3: `"rpvChangeV3"`,
    elementchanged: `"elementChanged"`,
    changetype: `"changeType"`,
    observedrevenueimpact: `"observedRevenueImpact"`,
    optimizelylink: `"optimizelyLink"`,
    lessonlearned: `"lessonLearned"`,
    metrics: `"primaryMetricName"`, // map generic metrics to primary metric name
    uuid: `"id"` // map mistaken uuid column reference to primary key id
  };
  for (const [raw, quoted] of Object.entries(columnMap)) {
    result = result.replace(new RegExp(`(?<!")\\b${raw}\\b(?!")`, "gi"), quoted);
  }
  // Also handle quoted uuid references ("uuid") that slip through.
  result = result.replace(/"uuid"/gi, `"id"`);
  result = normalizeVerticalFilter(result);
  return result;
}

// Normalize MySQL-style DATE_SUB(date, interval 6 month) -> (date - interval '6 month')
function normalizeDateSub(sql: string) {
  return sql.replace(
    /date_sub\(\s*([^)]+?)\s*,\s*interval\s+(\d+)\s+(day|days|month|months|year|years)\s*\)/gi,
    "($1 - interval '$2 $3')"
  );
}

function sanitizeSql(sql: string) {
  let s = sql.replace(/;+\s*$/, "").trim();
  s = normalizeTableName(s);
  s = normalizeDateSub(s);
  s = normalizeIntervals(s);
  s = normalizeRound(s);
  s = ensureLimit(s);
  if (!isSelectOnly(s)) {
    throw new Error("Only SELECT queries are allowed.");
  }
  return s;
}

// Simplified: only add launchedBy filter if clearly a person query and not already present.
// The LLM prompt already handles most cases - this is just a safety net.
function enforceLaunchedBy(question: string, sql: string) {
  // If SQL already has launchedBy filter, don't modify
  if (/\blaunchedBy\b/i.test(sql)) return sql;
  
  // Only trigger for clear person patterns like "by John", "from Sarah"
  const nameMatch = question.match(/\b(?:by|from)\s+([A-Z][a-z]+)(?:\s|$|,|\?)/);
  if (!nameMatch) return sql;
  
  const name = nameMatch[1];
  
  // Block non-person terms
  const blockedNames = new Set([
    "monthly", "extrapolation", "top", "latest", "date", "concluded", "launched",
    "experiment", "experiments", "overlay", "loader", "the", "a", "an",
    // Verticals
    "solar", "panels", "heat", "pumps", "hearing", "aids", "merchant", "accounts",
    "boilers", "windows", "insulation", "chargers",
    // Geos - capitalized versions
    "uk", "us", "dk", "de", "au", "nz", "ca", "denmark", "germany", "australia",
    // Regions
    "americas", "emea", "apac", "row", "global",
    // Test terms
    "cta", "button", "form", "page", "test", "tests", "vertical", "geo"
  ]);
  
  if (blockedNames.has(name.toLowerCase())) return sql;
  
  // Don't modify - the LLM should handle this.
  // Only log for debugging if we would have modified.
  console.log(`[enforceLaunchedBy] Detected person name "${name}" but not modifying SQL - LLM should handle`);
  return sql;
}

function classifyMode(question: string): "sql" | "graph" {
  const q = question.toLowerCase();
  
  // Graph is best for: relationship/pattern analysis across change types and elements
  // SQL is best for: listings, counts, specific filters, learnings, winners/losers
  
  // Graph patterns - relationship/pattern queries that benefit from aggregated graph view
  const graphPatterns = [
    /relationship[s]?\s+(?:exist\s+)?between/i,
    /connection[s]?\s+(?:exist\s+)?between/i,
    /co-?occur/i,
    /co-?occurrence/i,
    /pattern[s]?\s+across/i,
    /clusters?\s+of/i,
    /how\s+are\s+.*\s+connected/i,
    /what\s+connects/i,
    /connected\s+to\s+.*\s+outcomes?/i
  ];
  
  // Check graph patterns first - these are strong signals
  for (const pattern of graphPatterns) {
    if (pattern.test(q)) {
      console.log(`[classifyMode] Graph pattern matched: ${pattern}`);
      return "graph";
    }
  }
  
  // These should go to SQL (better handled there)
  const sqlOverrides = [
    "list",
    "what did we learn",
    "what worked",
    "what hasn't",
    "biggest win",
    "largest win",
    "top winner",
    "failed experiment",
    "summary of",
    "how many"
  ];
  
  // If any SQL override matches, use SQL
  if (sqlOverrides.some((k) => q.includes(k))) {
    return "sql";
  }
  
  return "sql";
}

async function runSql(question: string) {
  const sqlPrompt = [
    {
      role: "system" as const,
      content: `You are a SQL assistant. Return JSON only, like {"sql": "...", "notes": "..."} on a single line (no line breaks inside values).

CRITICAL RULES:
- ALWAYS start with SELECT. NEVER use WITH clauses or CTEs. Only pure SELECT statements.
- Use only the Experiment table described. Reference it as "Experiment" (double-quoted).
- Always select the uuid id and experimentId so the UI can link to detail pages.
- SELECT-only. No writes/DDL.
- Default to the last 12 months if no date range given.
- Always include a LIMIT <= 500.
- Prefer dateConcluded; if missing, fall back to dateLaunched.
- Use ISO dates (YYYY-MM-DD).

VERTICAL FILTERING:
- ALWAYS use short wildcards for verticals: '%Solar%', '%Hearing%', '%Merchant%', '%Heat%'
- Do NOT use full names like '%Solar Panels%' or '%Hearing Aids%' - use the short form
- Example: vertical ILIKE '%Solar%' (not '%Solar Panels%')

GEO FILTERING:
- Use ILIKE with wildcards: geo ILIKE '%UK%', geo ILIKE '%DK%'

FAILED EXPERIMENTS - SIMPLE RULE:
- For "failed", "flat", or "didn't work" experiments: ONLY use (winningVar IS NULL OR winningVar = '')
- Do NOT add primarySignificance1 > 0.05 or negative CR/RPV conditions
- Keep it simple: failed = no winner

B2C/B2B FILTERING:
- B2C and B2B appear in testName field, NOT separate columns
- For B2C: "testName" ILIKE '%B2C%'
- For B2B: "testName" ILIKE '%B2B%'

REGIONAL FILTERING (Americas, RoW, etc.):
- ALWAYS check BOTH testName AND tradingHub for regions
- For Americas: ("testName" ILIKE '%AME%' OR "testName" ILIKE '%Americas%' OR "tradingHub" ILIKE '%Americas%')
- For RoW: ("testName" ILIKE '%RoW%' OR "tradingHub" ILIKE '%RoW%')

WINNERS:
- For "largest win", "best performing": ORDER BY "monthlyExtrap" DESC and filter "winningVar" IS NOT NULL

PERSON QUERIES:
- For "by <name>", "from <name>": filter on "launchedBy" ILIKE '%name%'

LEARNINGS QUERIES:
- When asked "what did we learn", include: "lessonLearned", "hypothesis", "winningVar", "changeType", "elementChanged"

PATTERN ANALYSIS:
- When asked about "patterns" or "characteristics", include: "changeType", "elementChanged", "vertical", "geo"

Schema columns include experimentId, testName, vertical, geo, targetMetric, changeType, elementChanged, winningVar, monthlyExtrap, hypothesis, lessonLearned, crChangeV1, crChangeV2, crChangeV3, rpvChangeV1, rpvChangeV2, rpvChangeV3, primarySignificance1, tradingHub, promoted, dates, etc.
`
    },
    { role: "user" as const, content: `Question: ${question}\nReturn JSON with fields sql and notes.` }
  ];

  const sqlResponse = await callLLM({ messages: sqlPrompt });
  const cleaned = sqlResponse.replace(/[\u0000-\u001f]+/g, " ");
  const parsed = JSON.parse(cleaned) as { sql: string; notes?: string };
  const finalSql = sanitizeSql(enforceLaunchedBy(question, parsed.sql));
  const rows = await prisma.$queryRawUnsafe(finalSql);
  const data = Array.isArray(rows) ? rows : [];
  const normalized = data.map((row) => {
    if (row && typeof row === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        out[k] = typeof v === "bigint" ? v.toString() : v;
      }
      return out;
    }
    return row;
  });
  return { sql: finalSql, notes: parsed.notes ?? "", rows: normalized, rowCount: normalized.length };
}

async function runGraph(question: string) {
  // Extract context from question for filtering
  const q = question.toLowerCase();
  const wantsFailed = q.includes("fail") || q.includes("failed") || q.includes("failing");
  const wantsWinners = q.includes("winner") || q.includes("winning") || q.includes("won") || q.includes("worked");
  
  // Try to extract vertical
  let vertical: string | undefined;
  const verticalPatterns = [/solar/i, /hearing/i, /merchant/i, /heat pump/i, /boiler/i, /window/i, /insulation/i, /charger/i];
  for (const p of verticalPatterns) {
    if (p.test(question)) {
      vertical = question.match(p)?.[0];
      break;
    }
  }

  // Try to extract geo
  let geo: string | undefined;
  const geoPatterns = [/\bUK\b/, /\bUS\b/, /\bDK\b/, /\bDE\b/, /\bAU\b/, /\bNZ\b/, /\bCA\b/];
  for (const p of geoPatterns) {
    if (p.test(question)) {
      geo = question.match(p)?.[0];
      break;
    }
  }

  const rows = await queryGraphPatterns({
    vertical,
    geo,
    onlyFailed: wantsFailed,
    onlyWinners: wantsWinners,
    monthsBack: 12,
    limit: 200
  });

  // If no results with date filter, try without
  if (!rows.length) {
    const broadRows = await queryGraphPatterns({
      vertical,
      geo,
      onlyFailed: wantsFailed,
      onlyWinners: wantsWinners,
      monthsBack: 120, // 10 years = effectively no date filter
      limit: 200
    });
    return {
      sql: "(graph pattern query from Postgres)",
      rows: broadRows,
      rowCount: broadRows.length,
    };
  }

  return {
    sql: "(graph pattern query from Postgres)",
    rows,
    rowCount: rows.length,
  };
}

async function summarize(question: string, modeUsed: "sql" | "graph", detail: any) {
  // Give the model a rich slice of data for comprehensive analysis.
  const allRows = detail.rows ?? [];
  const rows = allRows.slice(0, 50); // More rows for better analysis
  const totalRowCount = allRows.length;
  
  // Extract experiments with learnings
  const learningsRaw = allRows.filter((r: any) => r && typeof r === "object" && r.lessonLearned);
  const learnings = learningsRaw
    .slice(0, 20) // More learnings for richer insights
    .map((r: any) => ({
      testName: r.testName,
      changeType: r.changeType,
      elementChanged: r.elementChanged,
      lessonLearned: r.lessonLearned,
      hypothesis: r.hypothesis,
      winningVar: r.winningVar,
      crChangeV1: r.crChangeV1,
      rpvChangeV1: r.rpvChangeV1,
      monthlyExtrap: r.monthlyExtrap,
      vertical: r.vertical,
      geo: r.geo
    }));
  
  // Extract top winners for highlights
  const winners = allRows
    .filter((r: any) => r && r.winningVar && r.monthlyExtrap)
    .sort((a: any, b: any) => (b.monthlyExtrap || 0) - (a.monthlyExtrap || 0))
    .slice(0, 5)
    .map((r: any) => ({
      testName: r.testName,
      monthlyExtrap: r.monthlyExtrap,
      winningVar: r.winningVar,
      crChangeV1: r.crChangeV1,
      vertical: r.vertical
    }));
  
  // Calculate basic stats
  const stats = {
    totalExperiments: totalRowCount,
    withLearnings: learningsRaw.length,
    withWinners: allRows.filter((r: any) => r && r.winningVar).length,
    uniqueVerticals: [...new Set(allRows.map((r: any) => r?.vertical).filter(Boolean))].length,
    uniqueGeos: [...new Set(allRows.map((r: any) => r?.geo).filter(Boolean))].length
  };
  
  const source = modeUsed === "sql" ? `SQL: ${detail.sql}` : `Graph pattern query (Postgres)`;
  const prompt = [
    {
      role: "system" as const,
      content: `You are a senior CRO analyst. Generate a comprehensive, detailed analysis from the provided experiment data.

OUTPUT FORMAT (use markdown headers and formatting):

## Executive Summary
A 2-3 sentence overview answering the user's question directly.

## Key Highlights
• 4-6 bullet points with specific numbers, percentages, and experiment names
• Include top performers with their metrics (e.g., "+15% CR", "£50K monthly impact")
• Mention patterns you observe in the data

## Data Coverage
• Total experiments analyzed: X
• Time window: [infer from data or mention if not specified]
• Verticals covered: X unique
• Geographic regions: X unique

## Detailed Learnings
For each major insight, provide:
### [Learning Category/Theme]
**What we tested:** Brief description of the experiment approach
**What worked:** Specific results with metrics
**What didn't work:** Any negative findings (if applicable)
**Key quote:** Direct quote from lessonLearned field (if available)
**Example experiments:** List 1-2 specific test names

Include 3-5 detailed learning sections based on the data.

## Patterns & Trends
• Cross-cutting patterns you observe (e.g., "CTA changes consistently outperform form changes")
• Vertical-specific insights (e.g., "Solar Panels responds well to trust signals")
• Geographic patterns (if applicable)

## Recommended Next Steps
1. Specific, actionable recommendation based on the data
2. Another specific recommendation
3. Questions to explore further

Be specific and data-driven. Quote actual test names, metrics, and lessons. Avoid generic statements.
If the data is limited, acknowledge it but still provide whatever insights you can.`
    },
    {
      role: "user" as const,
      content: `Question: ${question}

Query Mode: ${modeUsed}
${source}

Data Summary:
- Total rows: ${totalRowCount}
- Experiments with learnings: ${stats.withLearnings}
- Experiments with winners: ${stats.withWinners}
- Unique verticals: ${stats.uniqueVerticals}
- Unique geos: ${stats.uniqueGeos}

Top Winners:
${JSON.stringify(winners, null, 2)}

Sample Rows (${rows.length} of ${totalRowCount}):
${JSON.stringify(rows, null, 2)}

Experiments with Learnings (${learnings.length}):
${JSON.stringify(learnings, null, 2)}`
    }
  ];
  const answer = await callLLM({ messages: prompt, maxTokens: 2000 });
  return answer.trim();
}

function ensureAuthorized(req: NextRequest) {
  const apiKeyHeader = req.headers.get("x-internal-api-key");
  const expected = process.env.AI_INTERNAL_API_KEY;
  if (expected && apiKeyHeader === expected) return true;
  return false;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { question?: string; mode?: Mode };
  const question = (body.question ?? "").toString().trim();
  const mode = (body.mode as Mode) ?? "auto";
  if (!question) return NextResponse.json({ error: "Question is required" }, { status: 400 });

  const internalAllowed = ensureAuthorized(request);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  });
  if (!token && !internalAllowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Smart routing: auto-detect best mode, or respect explicit choice
    let chosen: "sql" | "graph";
    if (mode === "auto") {
      chosen = classifyMode(question);
      console.log(`[AI Ask] Auto-classified "${question.slice(0, 50)}..." as ${chosen}`);
    } else {
      chosen = mode === "graph" ? "graph" : "sql";
    }
    
    let primaryResult: any;
    let modeUsed: "sql" | "graph" = chosen;
    let fallbackUsed = false;

    if (chosen === "graph") {
      // Try graph first (now uses Postgres)
      try {
        primaryResult = await runGraph(question);
        modeUsed = "graph";
        
        // If graph returns no meaningful results, fallback to SQL (unless explicitly requested)
        if ((!primaryResult.rows?.length || primaryResult.rows.length < 3) && mode === "auto") {
          console.log(`[AI Ask] Graph returned few results (${primaryResult.rows?.length || 0}), falling back to SQL`);
          primaryResult = await runSql(question);
          modeUsed = "sql";
          fallbackUsed = true;
        }
      } catch (e) {
        if (mode === "auto") {
          // Auto mode: fallback to SQL on graph error
          console.log(`[AI Ask] Graph failed, falling back to SQL:`, e instanceof Error ? e.message : e);
          primaryResult = await runSql(question);
          modeUsed = "sql";
          fallbackUsed = true;
        } else {
          // Explicit graph mode: surface the error
          const msg = e instanceof Error ? e.message : String(e);
          return NextResponse.json({ error: msg }, { status: 400 });
        }
      }
    } else {
      // SQL mode
      primaryResult = await runSql(question);
      modeUsed = "sql";
    }

    const answer = await summarize(question, modeUsed, primaryResult);

    return NextResponse.json({
      modeRequested: mode,
      modeClassified: chosen,
      modeUsed,
      answer,
      rows: primaryResult.rows ?? [],
      rowCount: primaryResult.rowCount ?? (primaryResult.rows ? primaryResult.rows.length : 0),
      sql: primaryResult.sql,
      notes: primaryResult.notes,
      fallbackUsed
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

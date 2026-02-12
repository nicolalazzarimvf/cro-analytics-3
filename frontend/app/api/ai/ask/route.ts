import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { callLLM } from "@/lib/ai/client";
import { prisma } from "@/lib/db/client";
import { queryGraphPatterns } from "@/lib/graph/postgres";

type SqlResult = {
  sql: string;
  notes: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  error?: string;
};

type GraphResult = {
  rows: Array<{ changeType: string; elementChanged: string; experimentCount: number }>;
  rowCount: number;
  error?: string;
};

type GraphExperiment = {
  id: string;
  experimentId: string;
  testName: string | null;
  changeType: string | null;
  elementChanged: string | null;
  winningVar: string | null;
};

function isSelectOnly(sql: string) {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith("select")) return false;
  const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate"];
  return !forbidden.some((kw) => trimmed.includes(`${kw} `));
}

function ensureLimit(sql: string, max = 2000) {
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

/**
 * Ensure essential columns are present in the SELECT so the graph can link
 * experiments to their changeType and elementChanged attributes.
 */
function ensureGraphColumns(sql: string) {
  // Only inject into simple SELECTs from the Experiment table (not sub-selects or GROUP BY aggregations)
  const isSimpleSelect = /^SELECT\b/i.test(sql.trim());
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(sql);
  const hasExperimentTable = /\bFROM\s+"Experiment"/i.test(sql);
  if (!isSimpleSelect || hasGroupBy || !hasExperimentTable) return sql;

  const requiredCols = [
    { name: "changeType", quoted: '"changeType"' },
    { name: "elementChanged", quoted: '"elementChanged"' },
    { name: "testName", quoted: '"testName"' },
  ];

  let result = sql;
  for (const col of requiredCols) {
    // Check if column is already selected (quoted or unquoted)
    const alreadyPresent = new RegExp(`\\b${col.name}\\b`, "i").test(
      result.slice(0, result.search(/\bFROM\b/i))
    );
    if (!alreadyPresent) {
      // Insert after "SELECT " or "SELECT DISTINCT "
      result = result.replace(
        /^(SELECT\s+(?:DISTINCT\s+)?)/i,
        `$1${col.quoted}, `
      );
    }
  }
  return result;
}

function sanitizeSql(sql: string) {
  let s = sql.replace(/;+\s*$/, "").trim();
  s = normalizeTableName(s);
  s = normalizeDateSub(s);
  s = normalizeIntervals(s);
  s = normalizeRound(s);
  s = ensureGraphColumns(s);
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

async function runSql(question: string): Promise<SqlResult> {
  const sqlPrompt = [
    {
      role: "system" as const,
      content: `You are a SQL assistant. Return JSON only, like {"sql": "...", "notes": "..."} on a single line (no line breaks inside values).

CRITICAL RULES:
- ALWAYS start with SELECT. NEVER use WITH clauses or CTEs. Only pure SELECT statements.
- Use only the Experiment table described. Reference it as "Experiment" (double-quoted).
- Always select the uuid id, experimentId, testName, changeType, and elementChanged so the UI can link to detail pages and build the experiment graph.
- SELECT-only. No writes/DDL.
- Default to the last 12 months if no date range given.
- Always include a LIMIT <= 2000.
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

async function runGraph(question: string): Promise<GraphResult> {
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
    limit: 500
  });

  // If no results with date filter, try without
  if (!rows.length) {
    const broadRows = await queryGraphPatterns({
      vertical,
      geo,
      onlyFailed: wantsFailed,
      onlyWinners: wantsWinners,
      monthsBack: 120, // 10 years = effectively no date filter
      limit: 500
    });
    return { rows: broadRows, rowCount: broadRows.length };
  }

  return { rows, rowCount: rows.length };
}

/**
 * Fetch individual experiments with their graph-relevant attributes.
 * Uses the same filter extraction as runGraph so the experiments match
 * the graph patterns. These are sent to the frontend for graph expansion.
 */
async function runGraphExperiments(question: string): Promise<GraphExperiment[]> {
  const q = question.toLowerCase();
  const wantsFailed = q.includes("fail") || q.includes("failed") || q.includes("failing");
  const wantsWinners = q.includes("winner") || q.includes("winning") || q.includes("won") || q.includes("worked");

  const where: string[] = [
    `"changeType" IS NOT NULL AND "changeType" != ''`,
    `"elementChanged" IS NOT NULL AND "elementChanged" != ''`,
  ];
  const params: any[] = [];
  let idx = 1;

  // Date filter — last 12 months
  where.push(
    `(("dateConcluded" >= NOW() - INTERVAL '12 months') OR ("dateLaunched" >= NOW() - INTERVAL '12 months') OR ("dateConcluded" IS NULL AND "dateLaunched" IS NULL))`
  );

  // Vertical
  const verticalPatterns = [/solar/i, /hearing/i, /merchant/i, /heat pump/i, /boiler/i, /window/i, /insulation/i, /charger/i];
  for (const p of verticalPatterns) {
    if (p.test(question)) {
      where.push(`"vertical" ILIKE $${idx}`);
      params.push(`%${question.match(p)?.[0]}%`);
      idx++;
      break;
    }
  }

  // Geo
  const geoPatterns = [/\bUK\b/, /\bUS\b/, /\bDK\b/, /\bDE\b/, /\bAU\b/, /\bNZ\b/, /\bCA\b/];
  for (const p of geoPatterns) {
    if (p.test(question)) {
      where.push(`"geo" ILIKE $${idx}`);
      params.push(`%${question.match(p)?.[0]}%`);
      idx++;
      break;
    }
  }

  if (wantsFailed) where.push(`("winningVar" IS NULL OR "winningVar" = '')`);
  if (wantsWinners) where.push(`"winningVar" IS NOT NULL AND "winningVar" != ''`);

  const sql = `
    SELECT "id", "experimentId", "testName", "changeType", "elementChanged", "winningVar"
    FROM "Experiment"
    WHERE ${where.join(" AND ")}
    ORDER BY COALESCE("dateConcluded", "dateLaunched") DESC NULLS LAST
    LIMIT 500
  `;

  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  return (Array.isArray(rows) ? rows : []) as GraphExperiment[];
}

async function summarize(
  question: string,
  sqlResult: SqlResult | null,
  graphResult: GraphResult | null
) {
  // --- SQL data extraction ---
  const sqlRows = sqlResult?.rows ?? [];
  const sqlSample = sqlRows.slice(0, 200);

  const learningsRaw = sqlRows.filter((r: any) => r && typeof r === "object" && r.lessonLearned);
  const learnings = learningsRaw
    .slice(0, 50)
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

  const winners = sqlRows
    .filter((r: any) => r && r.winningVar && r.monthlyExtrap)
    .sort((a: any, b: any) => (Number(b.monthlyExtrap) || 0) - (Number(a.monthlyExtrap) || 0))
    .slice(0, 10)
    .map((r: any) => ({
      testName: r.testName,
      monthlyExtrap: r.monthlyExtrap,
      winningVar: r.winningVar,
      crChangeV1: r.crChangeV1,
      vertical: r.vertical
    }));

  const stats = {
    totalExperiments: sqlRows.length,
    withLearnings: learningsRaw.length,
    withWinners: sqlRows.filter((r: any) => r && r.winningVar).length,
    uniqueVerticals: [...new Set(sqlRows.map((r: any) => r?.vertical).filter(Boolean))].length,
    uniqueGeos: [...new Set(sqlRows.map((r: any) => r?.geo).filter(Boolean))].length
  };

  // --- Graph data extraction ---
  const graphRows = graphResult?.rows ?? [];
  const graphSample = graphRows.slice(0, 100);

  // --- Build prompt sections ---
  let dataSections = "";

  if (sqlResult && !sqlResult.error && sqlRows.length > 0) {
    dataSections += `
## SQL Results (individual experiments)
SQL used: ${sqlResult.sql}

Data Summary:
- Total rows: ${sqlRows.length}
- Experiments with learnings: ${stats.withLearnings}
- Experiments with winners: ${stats.withWinners}
- Unique verticals: ${stats.uniqueVerticals}
- Unique geos: ${stats.uniqueGeos}

Top Winners:
${JSON.stringify(winners, null, 2)}

Sample Rows (${sqlSample.length} of ${sqlRows.length}):
${JSON.stringify(sqlSample, null, 2)}

Experiments with Learnings (${learnings.length}):
${JSON.stringify(learnings, null, 2)}
`;
  } else if (sqlResult?.error) {
    dataSections += `\n## SQL Results\nSQL query failed: ${sqlResult.error}\n`;
  }

  if (graphResult && !graphResult.error && graphRows.length > 0) {
    dataSections += `
## Graph Pattern Results (aggregated changeType → elementChanged combinations)
Total patterns: ${graphRows.length}

Top patterns (${graphSample.length}):
${JSON.stringify(graphSample, null, 2)}
`;
  } else if (graphResult?.error) {
    dataSections += `\n## Graph Pattern Results\nGraph query failed: ${graphResult.error}\n`;
  }

  const prompt = [
    {
      role: "system" as const,
      content: `You are a senior CRO analyst. Generate a comprehensive analysis from the provided experiment data.
You have two data sources:
1. **SQL results** — individual experiment rows with full details (names, metrics, learnings, winners).
2. **Graph pattern results** — aggregated counts of changeType → elementChanged combinations showing what types of changes are most common.

Use BOTH sources to give the richest possible answer. Draw specific experiment examples from the SQL data and high-level patterns from the graph data.

OUTPUT FORMAT (use markdown headers and formatting):

## Executive Summary
A 2-3 sentence overview answering the user's question directly.

## Key Highlights
• 4-6 bullet points with specific numbers, percentages, and experiment names
• Include top performers with their metrics (e.g., "+15% CR", "£50K monthly impact")
• Mention patterns you observe in both SQL and graph data

## Data Coverage
• Total experiments analyzed: X
• Graph patterns found: X
• Time window: [infer from data]
• Verticals covered: X unique
• Geographic regions: X unique

## Detailed Learnings
For each major insight, provide:
### [Learning Category/Theme]
**What we tested:** Brief description
**What worked:** Specific results with metrics
**What didn't work:** Negative findings (if applicable)
**Key quote:** Direct quote from lessonLearned (if available)
**Example experiments:** 1-2 specific test names

Include 3-5 detailed learning sections.

## Patterns & Trends
• Cross-cutting patterns from the graph data (e.g., "CTA changes on Buttons are the most common combination with X experiments")
• Vertical-specific insights
• Geographic patterns (if applicable)

## Recommended Next Steps
1. Specific, actionable recommendation
2. Another recommendation
3. Questions to explore further

Be specific and data-driven. Quote actual test names, metrics, and lessons. Avoid generic statements.
If one data source is empty or failed, still provide analysis from the other.`
    },
    {
      role: "user" as const,
      content: `Question: ${question}\n${dataSections}`
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
  const body = (await request.json().catch(() => ({}))) as { question?: string };
  const question = (body.question ?? "").toString().trim();
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
    // Run SQL, Graph patterns, and Graph experiments in parallel
    const [sqlResult, graphResult, graphExperiments] = await Promise.all([
      runSql(question).catch((e): SqlResult => {
        console.error(`[AI Ask] SQL failed:`, e instanceof Error ? e.message : e);
        return { sql: "", notes: "", rows: [], rowCount: 0, error: e instanceof Error ? e.message : String(e) };
      }),
      runGraph(question).catch((e): GraphResult => {
        console.error(`[AI Ask] Graph failed:`, e instanceof Error ? e.message : e);
        return { rows: [], rowCount: 0, error: e instanceof Error ? e.message : String(e) };
      }),
      runGraphExperiments(question).catch((e): GraphExperiment[] => {
        console.error(`[AI Ask] Graph experiments failed:`, e instanceof Error ? e.message : e);
        return [];
      }),
    ]);

    // If both failed, return an error
    if (sqlResult.error && graphResult.error) {
      return NextResponse.json(
        { error: `Both queries failed. SQL: ${sqlResult.error}. Graph: ${graphResult.error}` },
        { status: 400 }
      );
    }

    console.log(
      `[AI Ask] SQL: ${sqlResult.error ? "FAILED" : `${sqlResult.rowCount} rows`}, ` +
      `Graph: ${graphResult.error ? "FAILED" : `${graphResult.rowCount} patterns`}`
    );

    // Summarize using both result sets
    const answer = await summarize(question, sqlResult, graphResult);

    return NextResponse.json({
      answer,
      // SQL results for the data table
      sql: sqlResult.sql || undefined,
      sqlError: sqlResult.error || undefined,
      notes: sqlResult.notes || undefined,
      rows: sqlResult.rows ?? [],
      rowCount: sqlResult.rowCount ?? 0,
      // Graph results for the pattern visualisations
      graphRows: graphResult.rows ?? [],
      graphRowCount: graphResult.rowCount ?? 0,
      graphError: graphResult.error || undefined,
      // Individual experiments for graph expand
      graphExperiments: graphExperiments ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

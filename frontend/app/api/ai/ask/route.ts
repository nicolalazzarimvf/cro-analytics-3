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
  vertical: string | null;
  geo: string | null;
  monthlyExtrap: number | null;
  dateConcluded: string | null;
};

function isSelectOnly(sql: string) {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith("select")) return false;
  const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate"];
  return !forbidden.some((kw) => trimmed.includes(`${kw} `));
}

function ensureLimit(sql: string, max = 2000) {
  // If the LLM already included a LIMIT, override it if it's too small
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch) {
    const existing = Number(limitMatch[1]);
    if (existing < max) {
      return sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${max}`);
    }
    return sql;
  }
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
 * Ensure essential columns are present in the SELECT so the UI can build
 * breakdowns (vertical, geo, winners) and the graph (changeType, elementChanged).
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
    { name: "vertical", quoted: '"vertical"' },
    { name: "geo", quoted: '"geo"' },
    { name: "winningVar", quoted: '"winningVar"' },
    { name: "monthlyExtrap", quoted: '"monthlyExtrap"' },
    { name: "dateConcluded", quoted: '"dateConcluded"' },
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
- Default to the last 24 months if no date range given.
- ALWAYS use LIMIT 2000 unless the user asks for fewer results.
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
    monthsBack: 24,
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
    // At least one attribute must be present (OR, not AND)
    `(("changeType" IS NOT NULL AND "changeType" != '') OR ("elementChanged" IS NOT NULL AND "elementChanged" != ''))`,
  ];
  const params: any[] = [];
  let idx = 1;

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

  // First try with 24-month window
  const dateWhere = [...where, `(("dateConcluded" >= NOW() - INTERVAL '24 months') OR ("dateLaunched" >= NOW() - INTERVAL '24 months') OR ("dateConcluded" IS NULL AND "dateLaunched" IS NULL))`];

  const sql = `
    SELECT "id", "experimentId", "testName", "changeType", "elementChanged",
           "winningVar", "vertical", "geo", "monthlyExtrap", "dateConcluded"
    FROM "Experiment"
    WHERE ${dateWhere.join(" AND ")}
    ORDER BY COALESCE("dateConcluded", "dateLaunched") DESC NULLS LAST
    LIMIT 500
  `;

  let rows = await prisma.$queryRawUnsafe(sql, ...params);
  let result = (Array.isArray(rows) ? rows : []) as GraphExperiment[];

  // If too few results, retry without date filter
  if (result.length < 50) {
    console.log(`[AI Ask] Graph experiments: only ${result.length} with date filter, retrying without`);
    const broadSql = `
      SELECT "id", "experimentId", "testName", "changeType", "elementChanged",
             "winningVar", "vertical", "geo", "monthlyExtrap", "dateConcluded"
      FROM "Experiment"
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE("dateConcluded", "dateLaunched") DESC NULLS LAST
      LIMIT 500
    `;
    rows = await prisma.$queryRawUnsafe(broadSql, ...params);
    result = (Array.isArray(rows) ? rows : []) as GraphExperiment[];
  }

  console.log(`[AI Ask] Graph experiments: ${result.length} found`);
  return result;
}

async function summarize(
  question: string,
  sqlResult: SqlResult | null,
  graphResult: GraphResult | null,
  graphExperiments: GraphExperiment[] = []
) {
  // --- SQL data extraction ---
  const sqlRows = sqlResult?.rows ?? [];
  const sqlSample = sqlRows.slice(0, 200);

  const learningsRaw = sqlRows.filter((r: any) => r && typeof r === "object" && r.lessonLearned);
  const learnings = learningsRaw
    .slice(0, 80)
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
    .slice(0, 20)
    .map((r: any) => ({
      testName: r.testName,
      monthlyExtrap: r.monthlyExtrap,
      winningVar: r.winningVar,
      crChangeV1: r.crChangeV1,
      rpvChangeV1: r.rpvChangeV1,
      vertical: r.vertical,
      geo: r.geo
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

  // --- Graph experiments (individual rows with attributes — always available) ---
  const graphExpSample = graphExperiments.slice(0, 150);
  const graphExpWinners = graphExperiments.filter((e) => e.winningVar).length;
  const graphExpVerticals = [...new Set(graphExperiments.map((e) => e.vertical).filter(Boolean))];
  const graphExpGeos = [...new Set(graphExperiments.map((e) => e.geo).filter(Boolean))];

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

Top Winners (${winners.length}):
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

  if (graphExperiments.length > 0) {
    dataSections += `
## Individual Experiments (from graph query — always available)
Total experiments: ${graphExperiments.length}
With winners: ${graphExpWinners}
Verticals: ${graphExpVerticals.join(", ") || "N/A"}
Geos: ${graphExpGeos.join(", ") || "N/A"}

Sample experiments (${graphExpSample.length} of ${graphExperiments.length}):
${JSON.stringify(graphExpSample, null, 2)}
`;
  }

  const prompt = [
    {
      role: "system" as const,
      content: `You are a senior CRO (Conversion Rate Optimisation) analyst writing an exhaustive report. You have THREE data sources:

1. **SQL results** — experiment rows from a direct database query (may be individual rows OR aggregated, depending on the question).
2. **Graph pattern results** — aggregated changeType → elementChanged combinations with experiment counts.
3. **Individual experiments** — always present: individual experiment rows with testName, changeType, elementChanged, winningVar, vertical, geo, monthlyExtrap, dateConcluded.

Cross-reference ALL three sources. Use individual experiments and SQL rows for specific examples, metrics, and quotes. Use graph patterns for macro trends. When SQL returns aggregated data, lean more on the individual experiments for detail.

RULES:
- Be EXHAUSTIVE and DATA-DRIVEN. Quote real test names, real metrics, real lessons.
- Never say "there isn't enough data" unless all sources are truly empty.
- For every claim, cite the experiment name or data point that supports it.
- Include CR change (crChangeV1), RPV change (rpvChangeV1), monthly extrapolation (monthlyExtrap) whenever available.
- Organise by theme, not randomly. Group related experiments together.

OUTPUT FORMAT (mandatory markdown — include ALL sections, make each substantial):

## Executive Summary
3-5 sentences directly answering the question. Include the single most important number and the single most important insight.

## Key Highlights
• 8-12 bullet points, each citing a specific experiment and metric
• Top winners by monthly impact with exact numbers
• Top winners by CR/RPV lift with exact percentages
• Most common change types tested (with counts from graph data)
• Win rate across the dataset
• Any notable failures or surprising results

## Data Coverage
• Total experiments analysed, with winners count and win rate %
• Time window covered
• Verticals: list each unique vertical with experiment count
• Geos: list each unique geo with experiment count
• Graph patterns found

## Detailed Learnings
Group by theme (e.g., by changeType, by elementChanged, by vertical, or by strategy). Include AT LEAST 5-8 sections, more if the data supports it. For each:

### [Theme Name]
**What we tested:** 2-3 sentence description of the experiments in this group
**What worked:** Specific results with metrics (CR%, RPV%, £ impact). Name the experiments.
**What didn't work:** Negative results or inconclusive tests (if any). Name the experiments.
**Lessons learned:** Direct quotes from lessonLearned field when available
**Key experiments:** List 2-5 specific test names with their outcomes

## Patterns & Trends
• Most frequently tested change types (from graph patterns, with experiment counts)
• Most frequently tested elements (from graph patterns, with experiment counts)
• Which changeType × elementChanged combos yield the highest win rates
• Vertical-specific patterns (which verticals test what)
• Geographic patterns (if data shows differences)
• Seasonal or temporal trends (if dateConcluded shows patterns)

## Recommended Next Steps
5-8 specific, actionable recommendations based on the data:
1. Under-explored areas that deserve more testing
2. Proven strategies to scale across verticals/geos
3. Failing patterns to stop investing in
4. New hypotheses suggested by the data
5. Specific experiment ideas with expected impact

Be thorough. A senior stakeholder reading this should walk away with a complete picture and clear next actions.`
    },
    {
      role: "user" as const,
      content: `Question: ${question}\n${dataSections}`
    }
  ];
  const answer = await callLLM({ messages: prompt, maxTokens: 5000 });
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

    const learningsCount = sqlResult.rows.filter((r: any) => r?.lessonLearned).length;
    const winnersCount = sqlResult.rows.filter((r: any) => r?.winningVar).length;

    console.log(`[AI Ask] ─── Query: "${question}" ───`);
    console.log(`[AI Ask] SQL: ${sqlResult.error ? `FAILED (${sqlResult.error})` : `${sqlResult.rowCount} rows fetched`}`);
    if (!sqlResult.error) {
      console.log(`[AI Ask]   └─ SQL used: ${sqlResult.sql}`);
      console.log(`[AI Ask]   └─ With learnings: ${learningsCount}, With winners: ${winnersCount}`);
      console.log(`[AI Ask]   └─ Sending to LLM: ${Math.min(sqlResult.rowCount, 200)} sample rows, ${Math.min(learningsCount, 50)} learnings, ${Math.min(winnersCount, 10)} top winners`);
    }
    console.log(`[AI Ask] Graph patterns: ${graphResult.error ? `FAILED (${graphResult.error})` : `${graphResult.rowCount} patterns`}`);
    if (!graphResult.error) {
      console.log(`[AI Ask]   └─ Sending to LLM: ${Math.min(graphResult.rowCount, 100)} patterns`);
    }
    console.log(`[AI Ask] Graph experiments (for UI panel): ${graphExperiments.length} experiments`);

    // Summarize using all three data sources
    const answer = await summarize(question, sqlResult, graphResult, graphExperiments);

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

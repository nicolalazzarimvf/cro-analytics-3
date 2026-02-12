import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/ai/client";
import { prisma } from "@/lib/db/client";
import { getToken } from "next-auth/jwt";
import { fetchEmbedding } from "@/lib/ai/embed";

const SCHEMA_DESCRIPTION = `
Table: Experiment
Columns:
- id (uuid)
- experimentId (text)
- testName (text)
- vertical (text)
- geo (text)
- launchedBy (text)
- userJourneyType (text)
- targetMetric (text)
- brand (text)
- monetisationMethod (text)
- promoted (boolean)
- variationsCount (int)
- baseUrl (text)
- audience (text)
- mobileTrafficPct (float)
- visitsControl (float)
- visitsVar1 (float)
- visitsVar2 (float)
- visitsVar3 (float)
- totalVisits (float)
- primaryMetricName (text)
- primaryControlConv (float)
- primaryVar1Conv (float)
- primaryVar2Conv (float)
- primaryVar3Conv (float)
- primarySignificance1 (float)
- secondaryMetricName (text)
- secondaryControlConv (float)
- secondaryVar1Conv (float)
- secondaryVar2Conv (float)
- secondaryVar3Conv (float)
- tertiaryMetricName (text)
- tertiaryControlConv (float)
- tertiaryVar1Conv (float)
- tertiaryVar2Conv (float)
- tertiaryVar3Conv (float)
- tradingHub (text)
- masterLever (text)
- lever (text)
- crChangeV1/V2/V3 (float)
- rpvChangeV1/V2/V3 (float)
- elementChanged (text)
- changeType (text)
- observedRevenueImpact (float)
- dateLaunched (timestamp)
- dateConcluded (timestamp)
- winningVar (text)
- monthlyExtrap (float)
- optimizelyLink (text)
- hypothesis (text)
- lessonLearned (text)
- screenshotDriveFileId/screenshotWebUrl/screenshotThumbnailUrl (text)
`;

function ensureLimit(sql: string, max = 500) {
  const hasLimit = /\blimit\s+\d+/i.test(sql);
  if (hasLimit) return sql;
  return `${sql.trim().replace(/;+\s*$/, "")} LIMIT ${max}`;
}

function isSelectOnly(sql: string) {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith("select")) return false;
  const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate"];
  return !forbidden.some((kw) => trimmed.includes(`${kw} `));
}

function normalizeTableName(sql: string) {
  // Ensure table name matches Postgres quoted name created by Prisma ("Experiment"), but do not double-quote if already quoted.
  let result = sql.replace(/(?<!")\bexperiment\b(?!")/gi, `"Experiment"`);
  // Quote column names that are camelCase to match Prisma schema; handle common mis-lowercased fields.
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
    ownername: `"launchedBy"`,
    owner: `"launchedBy"`
  };
  for (const [raw, quoted] of Object.entries(columnMap)) {
    result = result.replace(new RegExp(`(?<!")\\b${raw}\\b(?!")`, "gi"), quoted);
  }
  return result;
}

// Normalize interval syntax like "interval 6 months" -> "interval '6 months'"
function normalizeIntervals(sql: string) {
  return sql.replace(/interval\s+(\d+)\s+months?/gi, `interval '$1 months'`);
}

// Normalize round(column, n) on float columns to cast as numeric for Postgres compatibility.
function normalizeRound(sql: string) {
  return sql.replace(/round\(\s*([a-zA-Z0-9_."-]+)\s*,\s*(\d+)\s*\)/gi, `round(CAST($1 AS numeric), $2)`);
}

function normalizeNumbers(rows: unknown[]) {
  return rows.map((row) => {
    if (row && typeof row === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        if (typeof v === "bigint") {
          out[k] = v.toString();
        } else {
          out[k] = v;
        }
      }
      return out;
    }
    return row;
  });
}

function sanitizeSql(sql: string) {
  let s = sql.replace(/;+\s*$/, "").trim();
  s = normalizeTableName(s);
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

function buildSqlPrompt(question: string) {
  return [
    {
      role: "system" as const,
      content: `You are a SQL assistant. Return JSON only, like {"sql": "...", "notes": "..."} on a single line (no line breaks inside values).

CRITICAL RULES:
- ALWAYS start with SELECT. NEVER use WITH clauses or CTEs. Only pure SELECT statements.
- Use only the Experiment table described. Reference it as "Experiment" (double-quoted).
- SELECT-only. No writes/DDL.
- Default to the last 12 months if no date range given.
- Always include a LIMIT <= 500.
- Prefer dateConcluded; if missing, fall back to dateLaunched.
- Use ISO dates (YYYY-MM-DD).
- When using relative ranges, use Postgres interval syntax: e.g., CURRENT_DATE - INTERVAL '6 months'.

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

Schema:
${SCHEMA_DESCRIPTION}`
    },
    {
      role: "user" as const,
      content: `Question: ${question}\nReturn JSON with fields sql and notes.`
    }
  ];
}

function buildSummaryPrompt(
  question: string,
  sql: string,
  notes: string,
  rows: any[],
  total: number,
  similar: any[]
) {
  return [
    {
      role: "system" as const,
      content: `You summarise analytics results clearly and concisely. Keep it brief and actionable.`
    },
    {
      role: "user" as const,
      content: `Question: ${question}
SQL used: ${sql}
Notes: ${notes}
Rows returned (truncated): ${JSON.stringify(rows)}
Total row count: ${total}
Semantic similar experiments (truncated): ${JSON.stringify(similar)}

Provide:
- Answer (concise paragraphs or bullets)
- Highlights (3-5 bullets)
- Data window/filters used
- Suggested next tests (1-3 bullets)
If no data, say so and suggest a rephrase.`
    }
  ];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const question = (body.question ?? "").toString().trim();
    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    // Auth: allow signed-in users or requests with the internal API key header.
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
    });
    const internalKey = request.headers.get("x-internal-api-key");
    const internalAllowed =
      process.env.AI_INTERNAL_API_KEY && internalKey === process.env.AI_INTERNAL_API_KEY;
    if (!token && !internalAllowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Step 1: generate SQL
    const sqlResponse = await callLLM({ messages: buildSqlPrompt(question) });
    const cleaned = sqlResponse.replace(/[\u0000-\u001f]+/g, " ");
    let parsedSql: { sql: string; notes?: string } | null = null;
    try {
      parsedSql = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsedSql = JSON.parse(match[0].replace(/[\u0000-\u001f]+/g, " "));
        } catch {
          parsedSql = null;
        }
      }
    }
    if (!parsedSql?.sql) {
      return NextResponse.json(
        { error: "Could not parse SQL from model response", detail: sqlResponse },
        { status: 500 }
      );
    }

    const sqlWithOwner = enforceLaunchedBy(question, parsedSql.sql);
    const safeSql = sanitizeSql(sqlWithOwner);

    // Step 2: execute
    const rawRows = (await prisma.$queryRawUnsafe(safeSql)) as unknown[];
    const rows = Array.isArray(rawRows) ? normalizeNumbers(rawRows) : [];
    const rowCount = rows.length;
    const truncated = rowCount > 50 ? rows.slice(0, 50) : rows;

    // Step 2b: semantic similar experiments (best-effort)
    let similarRows: any[] = [];
    try {
      if (process.env.OPENAI_API_KEY) {
        const emb = await fetchEmbedding(question);
        const vectorLiteral = `[${emb.join(",")}]`;
        const sim = await prisma.$queryRawUnsafe(
          `SELECT "experimentId", "testName", vertical, geo, hypothesis, "lessonLearned", 1 - (embedding <=> $1::vector) AS score
           FROM "Experiment"
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT 20`,
          vectorLiteral
        );
        similarRows = Array.isArray(sim) ? normalizeNumbers(sim) : [];
      }
    } catch {
      // ignore semantic errors
    }

    // Step 3: summarise
    const summaryText = await callLLM({
      messages: buildSummaryPrompt(
        question,
        safeSql,
        parsedSql.notes ?? "",
        truncated,
        rowCount,
        similarRows.slice(0, 20)
      )
    });

    return NextResponse.json({
      answer: summaryText,
      sql: safeSql,
      notes: parsedSql.notes ?? "",
      rows: rows.slice(0, 200),
      rowCount,
      truncated: rowCount > 200,
      similar: similarRows
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

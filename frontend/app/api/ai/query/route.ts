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

// If the question includes "by/from <name>" (or the SQL already has a LIKE '%name%'), enforce a launchedBy filter in the SQL.
function enforceLaunchedBy(question: string, sql: string) {
  const nameMatch =
    question.match(/\b(?:by|from)\s+([a-zA-Z][\w\s'-]*)/i) ||
    sql.match(/like\s*'%([^%']+)%'/i);
  const name = nameMatch ? nameMatch[1].trim().split(/\s+/)[0] : null;
  if (!name) return sql;
  const condition = `("launchedBy" ILIKE '%${name}%' OR "testName" ILIKE '%${name}%')`;
  // If the SQL is already filtering on launchedBy, leave it.
  if (/\b"launchedBy"\b/i.test(sql)) return sql;
  // Replace naive LIKE on testName/owner fields with launchedBy
  sql = sql.replace(/\b"testName"\s+LIKE\s+'%[^%']+%'/i, condition);
  sql = sql.replace(/\bownerName\b/gi, `"launchedBy"`);
  sql = sql.replace(/\bowner\b/gi, `"launchedBy"`);
  const trimmed = sql.replace(/;+\s*$/, "").trim();
  // If there is a LIMIT, insert the condition before it.
  const limitMatch = trimmed.match(/\blimit\s+\d+/i);
  if (limitMatch) {
    const [limitStr] = limitMatch;
    const beforeLimit = trimmed.slice(0, limitMatch.index).trim();
    // If there's already a WHERE, append with AND, else add WHERE.
    const hasWhere = /\bwhere\b/i.test(beforeLimit);
    const newBeforeLimit = hasWhere ? `${beforeLimit} AND ${condition}` : `${beforeLimit} WHERE ${condition}`;
    return `${newBeforeLimit} ${limitStr}`;
  }
  // No limit: append condition with WHERE/AND.
  const hasWhere = /\bwhere\b/i.test(trimmed);
  return hasWhere ? `${trimmed} AND ${condition}` : `${trimmed} WHERE ${condition}`;
}

function buildSqlPrompt(question: string) {
  return [
    {
      role: "system" as const,
      content: `You are a SQL assistant. Return JSON only, like {"sql": "...", "notes": "..."} on a single line (no line breaks inside values).
Rules:
- Use only the Experiment table described. In SQL, reference it as "Experiment" (double-quoted).
- SELECT-only. No writes/DDL.
- Default to the last 12 months if no date range given.
- Always include a LIMIT <= 500.
- Prefer dateConcluded; if missing, fall back to dateLaunched.
- If the question is about a person/owner (e.g., "by <name>", "from <name>"), filter on launchedBy using ILIKE '%name%'.
- Use ISO dates (YYYY-MM-DD).
- When using relative ranges, use Postgres interval syntax: e.g., CURRENT_DATE - INTERVAL '6 months'.
- When filtering by month, use an inclusive lower bound and exclusive upper bound: e.g., >= '2025-10-01' AND < '2025-11-01'.
- For time-windowed questions, consider both dateConcluded and dateLaunched where appropriate (e.g., concluded within window OR launched within window). For geo/vertical, treat geo separately from vertical (do not concatenate).
- For "failed experiments", include cases where winningVar is null/empty or the primarySignificance1 is above a typical threshold (e.g., > 0.05) or CR/RPV deltas are negative; make the WHERE reflect that.
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

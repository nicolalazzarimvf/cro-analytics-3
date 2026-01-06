import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { callLLM } from "@/lib/ai/client";
import { prisma } from "@/lib/db/client";
import { fetchEmbedding } from "@/lib/ai/embed";
import { getNeo4jSession } from "@/lib/neo4j/client";
import * as neo4j from "neo4j-driver";

type Mode = "auto" | "sql" | "graph";

const READ_ONLY_BLOCKLIST = /(create|merge|delete|set|remove|call\s+dbms|drop|load\s+csv|apoc\.load)/i;

const GRAPH_SCHEMA = `
Nodes/relationships:
- (:Experiment {experimentId, testName, dateLaunched, dateConcluded, winningVar, monthlyExtrap, targetMetric, changeType, elementChanged, primarySignificance1, crChangeV1, rpvChangeV1, hypothesis, lessonLearned})
- (:Vertical {name}) with (e)-[:IN_VERTICAL]->(vertical)
- (:Geo {code}) with (e)-[:IN_GEO]->(geo)
- (:Brand {name}) with (e)-[:FOR_BRAND]->(brand)
- (:TargetMetric {name}) with (e)-[:TARGETS]->(targetMetric)
- (:ChangeType {name}) with (e)-[:HAS_CHANGE_TYPE]->(changeType)
- (:ElementChanged {name}) with (e)-[:CHANGED_ELEMENT]->(elementChanged)
Guidance:
- If vertical mentioned, filter via IN_VERTICAL; brand only if brand is explicitly referenced; geo via IN_GEO when requested.
- If no date window is given, default to last 12 months (dateConcluded or dateLaunched).
- When asking what “worked”, prefer winningVar IS NOT NULL.
- Avoid returning “Other/Unknown” buckets when possible; order by count and apply LIMIT 200.
`;

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

// Force owner/person filters to use launchedBy (with a concluded date) instead of arbitrary LIKEs.
function enforceLaunchedBy(question: string, sql: string) {
  const nameMatch =
    question.match(/\b(?:by|from)\s+([a-zA-Z][\w\s'-]*)/i) || sql.match(/like\s*'%([^%']+)%'/i);
  const name = nameMatch ? nameMatch[1].trim().split(/\s+/)[0] : null;
  if (!name) return sql;
  const condition = `("launchedBy" ILIKE '%${name}%' OR "testName" ILIKE '%${name}%')`;
  const concludeCondition = `"dateConcluded" IS NOT NULL`;
  const trimmed = sql.replace(/;+\s*$/, "").trim();

  let base = trimmed.replace(/\bownerName\b/gi, `"launchedBy"`).replace(/\bowner\b/gi, `"launchedBy"`);
  base = base.replace(/\b"testName"\s+(?:I)?LIKE\s+'%[^%']+%'\s*(AND)?/gi, (_m, andWord) =>
    andWord ? "" : ""
  );
  base = base.replace(/\b"vertical"\s+(?:I)?LIKE\s+'%[^%']+%'\s*(AND)?/gi, (_m, andWord) =>
    andWord ? "" : ""
  );
  // Clean up dangling boolean operators
  base = base.replace(/\bWHERE\s*AND\s*/gi, "WHERE ");
  base = base.replace(/\sAND\s*(ORDER BY|LIMIT)\b/gi, " $1");
  base = base.replace(/\sAND\s*$/i, "");
  base = base.replace(/\bWHERE\s*(ORDER BY|LIMIT)\b/gi, "$1");

  if (/\b"launchedBy"\b/i.test(base)) return base;

  // Separate tail clauses (ORDER BY / LIMIT) so we can insert WHERE before them.
  let tail = "";
  let before = base;
  const tailMatch = base.match(/\b(order\s+by[\s\S]*|limit\s+\d[\s\S]*)$/i);
  if (tailMatch && typeof tailMatch.index === "number") {
    tail = tailMatch[0].trim();
    before = base.slice(0, tailMatch.index).trim();
  }

  before = before
    .replace(/\bWHERE\s*AND\s*/gi, "WHERE ")
    .replace(/\bWHERE\s*$/gi, "")
    .replace(/\bAND\s*$/gi, "")
    .trim();

  const hasWhere = /\bwhere\b/i.test(before);
  let withFilter = hasWhere ? `${before} AND ${condition}` : `${before} WHERE ${condition}`;
  if (!/\bdateConcluded\b/i.test(withFilter)) {
    const hasWhereNow = /\bwhere\b/i.test(withFilter);
    withFilter = hasWhereNow
      ? `${withFilter} AND ${concludeCondition}`
      : `${withFilter} WHERE ${concludeCondition}`;
  }
  return tail ? `${withFilter} ${tail}` : withFilter;
}

function sanitizeCypher(query: string) {
  let cleaned = query.trim().replace(/```/g, "").replace(/^cypher\s*/i, "").trim();
  cleaned = cleaned.replace(/\bstddevp\b/gi, "stdevp").replace(/\bstddev\b/gi, "stdev");

  if (!cleaned.toLowerCase().startsWith("match") && !cleaned.toLowerCase().startsWith("with")) {
    throw new Error("Only read-only MATCH/WITH queries are allowed");
  }
  if (READ_ONLY_BLOCKLIST.test(cleaned)) {
    throw new Error("Write/unsafe clauses are not allowed in graph endpoint");
  }
  return cleaned;
}

function serializeNeo4jValue(value: unknown): unknown {
  if (neo4j.isInt(value)) {
    return (value as neo4j.Integer).toNumber();
  }
  if (Array.isArray(value)) return value.map(serializeNeo4jValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeNeo4jValue(v);
    }
    return out;
  }
  return value;
}

function classifyMode(question: string): "sql" | "graph" {
  const q = question.toLowerCase();
  const graphKeys = [
    "relationship",
    "co-occur",
    "cooccur",
    "co occurrence",
    "network",
    "graph",
    "pattern across",
    "change type",
    "element changed",
    "connections",
    "clusters",
    "fail",
    "failed",
    "failing",
    "losing",
    "flat"
  ];
  return graphKeys.some((k) => q.includes(k)) ? "graph" : "sql";
}

async function runSql(question: string) {
  const sqlPrompt = [
    {
      role: "system" as const,
      content: `You are a SQL assistant. Return JSON only, like {"sql": "...", "notes": "..."} on a single line (no line breaks inside values).
Rules:
- Use only the Experiment table described. In SQL, reference it as "Experiment" (double-quoted).
- Always select the uuid id and experimentId so the UI can link to detail pages.
- SELECT-only. No writes/DDL.
- Default to the last 12 months if no date range given.
- Always include a LIMIT <= 500.
- Prefer dateConcluded; if missing, fall back to dateLaunched.
- Use ISO dates (YYYY-MM-DD).
- When filtering by month, use >= start AND < next month.
- For time windows, consider dateConcluded OR dateLaunched as appropriate.
Schema columns include experimentId, testName, vertical, geo, targetMetric, changeType, elementChanged, winningVar, monthlyExtrap, metrics, hypothesis, lessonLearned, dates, etc.
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
  const wantsFailed =
    question.toLowerCase().includes("fail") ||
    question.toLowerCase().includes("failed") ||
    question.toLowerCase().includes("failing");

  const fallbackCypher = wantsFailed
    ? `
MATCH (e:Experiment)-[:HAS_CHANGE_TYPE]->(ct:ChangeType)-[:CHANGED_ELEMENT]->(el:ElementChanged)
WHERE (e.winningVar IS NULL OR e.winningVar = "")
  AND (
    (exists(e.dateConcluded) AND datetime(e.dateConcluded) >= datetime() - duration({months:12}))
    OR (exists(e.dateLaunched) AND datetime(e.dateLaunched) >= datetime() - duration({months:12}))
    OR (NOT exists(e.dateConcluded) AND NOT exists(e.dateLaunched))
  )
WITH ct.name AS changeType, el.name AS elementChanged, count(e) AS experimentCount
WHERE NOT (changeType = "other" AND elementChanged = "other")
RETURN changeType, elementChanged, experimentCount
ORDER BY experimentCount DESC
LIMIT 200
`
    : `
MATCH (e:Experiment)-[:HAS_CHANGE_TYPE]->(ct:ChangeType)-[:CHANGED_ELEMENT]->(el:ElementChanged)
WHERE (
  (exists(e.dateConcluded) AND datetime(e.dateConcluded) >= datetime() - duration({months:12}))
  OR (exists(e.dateLaunched) AND datetime(e.dateLaunched) >= datetime() - duration({months:12}))
  OR (NOT exists(e.dateConcluded) AND NOT exists(e.dateLaunched))
)
WITH ct.name AS changeType, el.name AS elementChanged, count(e) AS experimentCount
WHERE NOT (changeType = "other" AND elementChanged = "other")
RETURN changeType, elementChanged, experimentCount
ORDER BY experimentCount DESC
LIMIT 200
`;

  const cypherPrompt = [
    {
      role: "system" as const,
      content: `
You convert questions into Cypher queries for the described Neo4j schema.
Return ONLY the Cypher code. Do not add prose. Use LIMIT 200 by default.
${GRAPH_SCHEMA}
            `.trim()
    },
    { role: "user" as const, content: `Question: ${question}\nCypher:` }
  ];

  let cypherText: string | null = null;
  let records: any[] = [];

  try {
    const llmResponse = await callLLM({ messages: cypherPrompt });
    cypherText = sanitizeCypher(llmResponse);
    const session = await getNeo4jSession();
    const result = await session.run(cypherText);
    records = result.records.map((r) => serializeNeo4jValue(r.toObject()));
    await session.close();
  } catch (err) {
    // Try a safe fallback query (failed-focused if relevant)
    cypherText = fallbackCypher.trim();
    const session = await getNeo4jSession();
    const result = await session.run(cypherText);
    records = result.records.map((r) => serializeNeo4jValue(r.toObject()));
    await session.close();
  }

  let filtered = records.filter((r) => {
    if (!r || typeof r !== "object") return false;
    const obj = r as Record<string, unknown>;
    const ct = (obj.changeType ?? "").toString().toLowerCase();
    const el = (obj.elementChanged ?? "").toString().toLowerCase();
    const isUnknownCt = !ct || ct.includes("unknown");
    const isUnknownEl = !el || el.includes("unknown");
    const isOtherCt = ct === "other";
    const isOtherEl = el === "other";
    return !((isUnknownCt || isOtherCt) && (isUnknownEl || isOtherEl));
  });

  // If we still have no rows and this is a "failed" question, try the fallback query explicitly.
  if (!filtered.length && wantsFailed) {
    cypherText = fallbackCypher.trim();
    const session = await getNeo4jSession();
    const result = await session.run(cypherText);
    const recs = result.records.map((r) => serializeNeo4jValue(r.toObject()));
    await session.close();
    filtered = recs;
  }

  // If still empty, run a very broad pairs query (no date filter) to guarantee some edge data.
  if (!filtered.length) {
    const broadCypher = `
MATCH (e:Experiment)-[:HAS_CHANGE_TYPE]->(ct:ChangeType)-[:CHANGED_ELEMENT]->(el:ElementChanged)
WITH ct.name AS changeType, el.name AS elementChanged, count(e) AS experimentCount
WHERE NOT (changeType = "other" AND elementChanged = "other")
RETURN changeType, elementChanged, experimentCount
ORDER BY experimentCount DESC
LIMIT 200
`.trim();
    cypherText = broadCypher;
    const session = await getNeo4jSession();
    const result = await session.run(broadCypher);
    const recs = result.records.map((r) => serializeNeo4jValue(r.toObject()));
    await session.close();
    filtered = recs;
  }

  return { cypher: cypherText ?? "", rows: filtered.length ? filtered : records, rowCount: records.length };
}

async function summarize(question: string, modeUsed: "sql" | "graph", detail: any) {
  // Give the model a small, rich slice of data.
  const rows = (detail.rows ?? []).slice(0, 30);
  const learningsRaw = (detail.rows ?? []).filter((r: any) => r && typeof r === "object" && r.lessonLearned);
  const learnings = learningsRaw
    .slice(0, 12)
    .map((r: any) => ({
      testName: r.testName,
      changeType: r.changeType,
      elementChanged: r.elementChanged,
      lessonLearned: r.lessonLearned,
      hypothesis: r.hypothesis,
      winningVar: r.winningVar,
      crChangeV1: r.crChangeV1,
      rpvChangeV1: r.rpvChangeV1
    }));
  const source = modeUsed === "sql" ? `SQL: ${detail.sql}` : `Cypher: ${detail.cypher}`;
  const prompt = [
    {
      role: "system" as const,
      content: `You are an analytics assistant. Produce a concise, learning-focused answer from the provided data.
Use changeType/elementChanged, hypothesis, and lessonLearned to extract what we tested and what we learned.
If lessonLearned is present, use it in "Learnings" with what worked/what didn't. If missing, infer from testName/hypothesis cautiously.
Favor rows with lessonLearned for the Learnings section. Include testName, changeType/elementChanged when useful.
Include 2-4 concrete learnings citing testName and a short snippet from lessonLearned/hypothesis, plus metric deltas if available (crChangeV1/rpvChangeV1/winningVar).
Include: Answer, Highlights (bullets), Data window/filters, Learnings (bullets with what worked/what didn’t), Graph patterns (bullets, if graph data), Next steps (1-3 bullets). Be specific; avoid generic statements.`
    },
    {
      role: "user" as const,
      content: `Question: ${question}
Mode: ${modeUsed}
${source}
Rows (truncated): ${JSON.stringify(rows)}
Selected learnings (if any): ${JSON.stringify(learnings)}`
    }
  ];
  const answer = await callLLM({ messages: prompt });
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
    // Hard override: in auto or sql mode we always run SQL only; never fall back to graph.
    const chosen: "sql" | "graph" = mode === "graph" ? "graph" : "sql";
    let primaryResult: any;
    let modeUsed: "sql" | "graph" = chosen;

    if (chosen === "sql") {
      primaryResult = await runSql(question);
    } else {
      // graph requested
      try {
        primaryResult = await runGraph(question);
        modeUsed = "graph";
      } catch (e) {
        // Do not fallback to SQL if user explicitly chose graph; surface the graph error.
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      if (!primaryResult.rows?.length) {
        // Keep graph mode; do not fallback to SQL in graph-only mode.
        modeUsed = "graph";
      }
    }

    const answer = await summarize(question, modeUsed, primaryResult);

    return NextResponse.json({
      modeRequested: mode,
      modeUsed,
      answer,
      rows: primaryResult.rows ?? [],
      rowCount: primaryResult.rowCount ?? (primaryResult.rows ? primaryResult.rows.length : 0),
      sql: primaryResult.sql,
      cypher: primaryResult.cypher,
      notes: primaryResult.notes,
      fallbackTried: false
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

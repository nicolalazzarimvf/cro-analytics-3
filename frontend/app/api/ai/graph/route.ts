import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/ai/client";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db/client";

async function ensureAuthorized(req: NextRequest) {
  const apiKeyHeader = req.headers.get("x-internal-api-key");
  const expected = process.env.AI_INTERNAL_API_KEY;
  if (expected && apiKeyHeader === expected) return true;

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  });
  return Boolean(token);
}

function isSelectOnly(sql: string) {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith("select")) return false;
  const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate"];
  return !forbidden.some((kw) => trimmed.includes(`${kw} `));
}

function sanitizeSql(query: string) {
  let cleaned = query.trim().replace(/```/g, "").replace(/^sql\s*/i, "").trim();
  cleaned = cleaned.replace(/;+\s*$/, "");
  
  if (!isSelectOnly(cleaned)) {
    throw new Error("Only SELECT queries are allowed in graph endpoint");
  }
  
  // Ensure LIMIT
  if (!/\blimit\s+\d+/i.test(cleaned)) {
    cleaned += " LIMIT 200";
  }
  
  return cleaned;
}

async function buildGraphSchemaContext() {
  return `
Graph data is stored in Postgres. The "Experiment" table has these relevant columns for graph/relationship queries:
- experimentId (unique identifier)
- testName
- changeType (e.g., "CTA", "Form", "Layout")
- elementChanged (e.g., "Button", "Hero", "Form")
- vertical (e.g., "Solar Panels", "Hearing Aids")
- geo (e.g., "UK", "US", "DK")
- brand
- targetMetric
- winningVar (null or empty = no winner)
- monthlyExtrap (revenue impact)
- dateLaunched, dateConcluded
- hypothesis, lessonLearned

For PATTERN/RELATIONSHIP queries, aggregate by changeType and elementChanged:
SELECT "changeType", "elementChanged", COUNT(*)::int AS "experimentCount"
FROM "Experiment"
WHERE "changeType" IS NOT NULL AND "elementChanged" IS NOT NULL
GROUP BY "changeType", "elementChanged"
ORDER BY "experimentCount" DESC
LIMIT 200

CRITICAL RULES:
- If vertical mentioned, filter with ILIKE '%Solar%' (short form)
- If geo mentioned, filter with ILIKE '%UK%'
- If no date window given, default to last 12 months using dateConcluded or dateLaunched
- For "failed" experiments: ONLY use ("winningVar" IS NULL OR "winningVar" = '')
- For "winners": use "winningVar" IS NOT NULL AND "winningVar" != ''
- Avoid "Other/Unknown" buckets - filter them out
- Always use LIMIT 200
- Table is "Experiment" (double-quoted)
- Column names are camelCase and must be double-quoted
`;
}

export async function POST(req: NextRequest) {
  if (!(await ensureAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  if (!question) return NextResponse.json({ error: "Missing question" }, { status: 400 });

  try {
    const schemaContext = await buildGraphSchemaContext();
    const llmResponse = await callLLM({
      messages: [
        {
          role: "system",
          content: `You convert questions into SQL queries for Postgres to analyze experiment patterns and relationships.

CRITICAL: Return ONLY the SQL code. No prose, no explanations, no markdown.

RULES:
- Use LIMIT 200 by default
- For "failed" experiments: ONLY use ("winningVar" IS NULL OR "winningVar" = ''). Keep it simple.
- For "winners": use "winningVar" IS NOT NULL
- Always filter out "other" and "unknown" values in WHERE clauses
- Use standard Postgres date functions (NOW(), INTERVAL)
- Aggregate results using GROUP BY and COUNT(*)
- Table is "Experiment" (double-quoted), columns are camelCase (double-quoted)`.trim()
        },
        { role: "user", content: `${schemaContext}\n\nQuestion: ${question}\nSQL:` }
      ]
    });

    const sql = sanitizeSql(llmResponse.trim());
    const rawRows = await prisma.$queryRawUnsafe(sql);
    const records = (Array.isArray(rawRows) ? rawRows : []).map((row) => {
      if (row && typeof row === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          out[k] = typeof v === "bigint" ? Number(v) : v;
        }
        return out;
      }
      return row;
    });

    return NextResponse.json({
      sql,
      rows: records,
      rowCount: records.length,
      truncated: false
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

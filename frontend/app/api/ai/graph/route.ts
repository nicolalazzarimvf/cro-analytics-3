import { NextRequest, NextResponse } from "next/server";
import { callLLM } from "@/lib/ai/client";
import { getNeo4jSession } from "@/lib/neo4j/client";
import { getToken } from "next-auth/jwt";
import * as neo4j from "neo4j-driver";

const READ_ONLY_BLOCKLIST = /(create|merge|delete|set|remove|call\s+dbms|drop|load\s+csv|apoc\.load)/i;

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

function sanitizeCypher(query: string) {
  let cleaned = query.trim().replace(/```/g, "").replace(/^cypher\s*/i, "").trim();
  // Normalize stddev variants to Neo4j functions
  cleaned = cleaned.replace(/\bstddevp\b/gi, "stdevp").replace(/\bstddev\b/gi, "stdev");

  if (!cleaned.toLowerCase().startsWith("match") && !cleaned.toLowerCase().startsWith("with")) {
    throw new Error("Only read-only MATCH/WITH queries are allowed");
  }
  if (READ_ONLY_BLOCKLIST.test(cleaned)) {
    throw new Error("Write/unsafe clauses are not allowed in graph endpoint");
  }
  return cleaned;
}

async function buildGraphSchemaContext() {
  // Minimal schema context for the LLM
  return `
Graph schema (Neo4j):
- (:Experiment {experimentId, testName, dateLaunched, dateConcluded, winningVar, monthlyExtrap, targetMetric, changeType, elementChanged, primarySignificance1, crChangeV1, rpvChangeV1, hypothesis, lessonLearned})
- (:Vertical {name}) with (e)-[:IN_VERTICAL]->(vertical)
- (:Geo {code}) with (e)-[:IN_GEO]->(geo)
- (:Brand {name}) with (e)-[:FOR_BRAND]->(brand)
- (:TargetMetric {name}) with (e)-[:TARGETS]->(targetMetric)
- (:ChangeType {name}) with (e)-[:HAS_CHANGE_TYPE]->(changeType)
- (:ElementChanged {name}) with (e)-[:CHANGED_ELEMENT]->(elementChanged)

Routing guidance:
- If the question mentions a vertical (e.g., "Hearing Aids"), filter via IN_VERTICAL to that Vertical.name.
- Use Brand only if the question explicitly refers to brand or brand names.
- Use Geo via IN_GEO when geo is requested.
`;
}

function serializeNeo4jValue(value: unknown): unknown {
  if (neo4j.isInt(value)) {
    return (value as neo4j.Integer).toNumber();
  }
  if (Array.isArray(value)) {
    return value.map(serializeNeo4jValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeNeo4jValue(v);
    }
    return out;
  }
  return value;
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
          content: `
You convert questions into Cypher queries for the described Neo4j schema.
Return ONLY the Cypher code. Do not add prose. Use LIMIT 200 by default.
            `.trim()
        },
        { role: "user", content: `${schemaContext}\n\nQuestion: ${question}\nCypher:` }
      ]
    });

    const cypher = sanitizeCypher(
      llmResponse.trim().replace(/```/g, "").replace(/^cypher\s*/i, "").trim()
    );

    const session = await getNeo4jSession();
    const result = await session.run(cypher);
    const records = result.records.map((r) => serializeNeo4jValue(r.toObject()));
    await session.close();

    return NextResponse.json({
      cypher,
      rows: records,
      rowCount: records.length,
      truncated: false
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

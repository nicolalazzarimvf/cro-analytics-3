import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { callLLM } from "@/lib/ai/client";

type Payload = {
  question: string;
  sql?: string;
  sqlNotes?: string;
  sqlRows?: any[];
  graphCypher?: string;
  graphRows?: any[];
};

function trimRows(rows: any[] | undefined, limit = 20) {
  if (!rows || !Array.isArray(rows)) return [];
  return rows.slice(0, limit);
}

function ensureAuthorized(req: NextRequest) {
  const apiKeyHeader = req.headers.get("x-internal-api-key");
  const expected = process.env.AI_INTERNAL_API_KEY;
  if (expected && apiKeyHeader === expected) return true;
  return false;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Payload;
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
    const sqlRows = trimRows(body.sqlRows, 20);
    // Graph: keep top 25 by occurrences/count and drop mostly unknown/other.
    let graphRows = Array.isArray(body.graphRows) ? [...body.graphRows] : [];
    graphRows.sort((a, b) => {
      const va = Number(a?.occurrences ?? a?.count ?? a?.wins ?? 0);
      const vb = Number(b?.occurrences ?? b?.count ?? b?.wins ?? 0);
      return vb - va;
    });
    graphRows = graphRows.slice(0, 25);

    const filteredGraphRows = graphRows.filter((r) => {
      const ct = (r?.changeType ?? "").toString().toLowerCase();
      const el = (r?.elementChanged ?? "").toString().toLowerCase();
      const isUnknownCt = !ct || ct.includes("unknown");
      const isUnknownEl = !el || el.includes("unknown");
      const isOtherCt = ct === "other";
      const isOtherEl = el === "other";
      return !((isUnknownCt || isOtherCt) && (isUnknownEl || isOtherEl));
    });

    const prompt = [
      {
        role: "system" as const,
        content: `
You are an analytics assistant. Combine SQL results and graph patterns into a single concise answer.
Prioritise graph-driven co-occurrence insights (changeType -> elementChanged, etc.) when they are strong; deprioritise unknown/other noise.
Return plain text with short sections: Answer, Highlights (bullets), Data window/filters, Graph patterns (bullets), Next steps (1-3 bullets).`
      },
      {
        role: "user" as const,
        content: `Question: ${question}
SQL: ${body.sql ?? "n/a"}
SQL notes: ${body.sqlNotes ?? "n/a"}
SQL rows (truncated): ${JSON.stringify(sqlRows)}
Graph cypher: ${body.graphCypher ?? "n/a"}
Graph rows (truncated): ${JSON.stringify(filteredGraphRows.length ? filteredGraphRows : graphRows)}
`
      }
    ];

    const combined = await callLLM({ messages: prompt });
    return NextResponse.json({ combined });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

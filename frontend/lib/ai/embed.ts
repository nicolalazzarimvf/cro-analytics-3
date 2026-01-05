import { config as loadEnv } from "dotenv";
import { prisma } from "@/lib/db/client";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.AI_EMBED_MODEL || "text-embedding-3-small";

function buildText(rec: {
  experimentId: string;
  testName: string;
  vertical?: string | null;
  geo?: string | null;
  brand?: string | null;
  hypothesis?: string | null;
  lessonLearned?: string | null;
}) {
  return [
    `Experiment ${rec.experimentId}: ${rec.testName}`,
    rec.vertical ? `Vertical: ${rec.vertical}` : "",
    rec.geo ? `Geo: ${rec.geo}` : "",
    rec.brand ? `Brand: ${rec.brand}` : "",
    rec.hypothesis ? `Hypothesis: ${rec.hypothesis}` : "",
    rec.lessonLearned ? `Lessons: ${rec.lessonLearned}` : ""
  ]
    .filter(Boolean)
    .join(" | ");
}

export async function fetchEmbedding(text: string) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for embeddings");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embedding error ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const emb = json.data?.[0]?.embedding;
  if (!emb) throw new Error("No embedding returned");
  return emb;
}

export async function embedMissingExperiments(limit = 100) {
  // Check embedding column exists
  const colCheck = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Experiment' AND column_name='embedding'`
  );
  if (!colCheck.length) {
    throw new Error('Embedding column "embedding" not found on Experiment. Run vector migration first.');
  }
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for embeddings");
  }

  const limitClause = limit && limit > 0 ? `LIMIT ${limit}` : "";

  const records = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      experimentId: string;
      testName: string;
      vertical: string | null;
      geo: string | null;
      brand: string | null;
      hypothesis: string | null;
      lessonLearned: string | null;
    }>
  >(
    `SELECT id, "experimentId", "testName", vertical, geo, brand, hypothesis, "lessonLearned"
     FROM "Experiment"
     WHERE embedding IS NULL
     ORDER BY "updatedAt" DESC
     ${limitClause}`
  );

  if (!records.length) {
    return { embedded: 0, remaining: 0 };
  }

  let embedded = 0;
  for (const rec of records) {
    const text = buildText(rec);
    const emb = await fetchEmbedding(text);
    const vectorLiteral = `[${emb.join(",")}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "Experiment" SET embedding = $1::vector WHERE id = $2`,
      vectorLiteral,
      rec.id
    );
    embedded += 1;
  }

  const remainingRows = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT COUNT(*) as cnt FROM "Experiment" WHERE embedding IS NULL`
  );
  const remaining = Number(remainingRows?.[0]?.cnt ?? 0);

  return { embedded, remaining };
}

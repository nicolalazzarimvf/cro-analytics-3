/**
 * Populate embeddings for experiments missing them.
 *
 * Prereqs:
 * - Postgres with pgvector installed and the embedding column added (migration add_vector_embeddings).
 * - OPENAI_API_KEY set. Uses text-embedding-3-small by default.
 * - Dev server not required; this is a standalone script.
 *
 * Usage:
 *   cd frontend && npx tsx scripts/embed-experiments.ts --limit 100
 */

import { config as loadEnv } from "dotenv";
import { embedMissingExperiments } from "@/lib/ai/embed";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const BATCH_LIMIT =
  Number(
    process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ??
      process.argv[process.argv.indexOf("--limit") + 1]
  ) || 50;

async function main() {
  try {
    const { embedded, remaining } = await embedMissingExperiments(BATCH_LIMIT);
    console.log(`Embedded ${embedded}. Remaining without embeddings: ${remaining}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

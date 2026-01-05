import "dotenv/config";
import { closeNeo4jDriver } from "../lib/neo4j/client";
import { syncExperimentsToNeo4j } from "../lib/neo4j/sync";

async function main() {
  const limit = Number(process.argv[2] ?? 500);
  try {
    const result = await syncExperimentsToNeo4j(limit);
    console.log(`Synced ${result.synced} experiments to Neo4j (limit ${limit}).`);
    await closeNeo4jDriver();
    process.exit(0);
  } catch (err) {
    console.error("Failed to sync to Neo4j:", err);
    await closeNeo4jDriver().catch(() => {});
    process.exit(1);
  }
}

main();

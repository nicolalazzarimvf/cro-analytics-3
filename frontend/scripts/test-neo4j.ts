import { closeNeo4jDriver, getNeo4jSession } from "../lib/neo4j/client";

async function main() {
  try {
    const session = await getNeo4jSession();
    const result = await session.run("RETURN 'connected' as status, datetime() as now, randomUUID() as trace");
    const record = result.records[0];
    console.log("Neo4j status:", {
      status: record.get("status"),
      now: record.get("now").toString(),
      trace: record.get("trace")
    });
    await session.close();
    await closeNeo4jDriver();
    console.log("Neo4j connection OK");
  } catch (err) {
    console.error("Neo4j connection failed:", err);
    process.exitCode = 1;
  }
}

main();

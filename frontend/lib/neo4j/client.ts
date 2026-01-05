import neo4j, { type Driver, type Session } from "neo4j-driver";

type DriverCache = { neo4jDriver?: Driver };
const globalForNeo4j = globalThis as unknown as DriverCache;

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for Neo4j`);
  return value;
}

export function getNeo4jDriver(): Driver {
  if (globalForNeo4j.neo4jDriver) return globalForNeo4j.neo4jDriver;

  const uri = getEnv("NEO4J_URI");
  const user = getEnv("NEO4J_USER");
  const password = getEnv("NEO4J_PASSWORD");

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  globalForNeo4j.neo4jDriver = driver;
  return driver;
}

export async function getNeo4jSession(): Promise<Session> {
  const driver = getNeo4jDriver();
  const database = process.env.NEO4J_DATABASE || "neo4j";
  return driver.session({ database });
}

export async function verifyNeo4jConnection() {
  const session = await getNeo4jSession();
  try {
    await session.run("RETURN 1 as ok");
  } finally {
    await session.close();
  }
}

export async function closeNeo4jDriver() {
  if (globalForNeo4j.neo4jDriver) {
    await globalForNeo4j.neo4jDriver.close();
    globalForNeo4j.neo4jDriver = undefined;
  }
}

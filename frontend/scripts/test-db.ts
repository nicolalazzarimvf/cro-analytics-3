import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local file BEFORE importing prisma client
const envPath = process.env.DOTENV_CONFIG_PATH || resolve(process.cwd(), ".env.local");
const result = config({ path: envPath });

if (result.error) {
  console.warn(`Warning: Could not load .env.local from ${envPath}:`, result.error.message);
}

// Now import prisma after env is loaded
const { prisma } = await import("../lib/db/client.js");

async function testDatabase() {
  console.log("Testing database connection...");
  console.log("Loading env from:", envPath);
  const dbUrl = process.env.DATABASE_URL;
  console.log("DATABASE_URL:", dbUrl ? `✓ Set (${dbUrl.substring(0, 20)}...)` : "✗ Missing");
  
  try {
    const startTime = Date.now();
    
    // Test basic connection
    await prisma.$queryRaw`SELECT 1 as test`;
    const elapsed = Date.now() - startTime;
    
    console.log(`✓ Database connection successful (${elapsed}ms)`);
    
    // Test table access
    const experimentCount = await prisma.experiment.count();
    console.log(`✓ Experiments table accessible (${experimentCount} experiments found)`);
    
    // Get database info
    const dbInfo = await prisma.$queryRaw<Array<{ version: string }>>`
      SELECT version() as version
    `;
    console.log(`✓ Database version: ${dbInfo[0]?.version?.split(' ')[0] || 'Unknown'}`);
    
    console.log("\n✅ Database is responding correctly!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Database connection failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for seeding");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}T00:00:00.000Z`;
}

async function main() {
  const prisma = createPrismaClient();

  const verticals = ["Ecommerce", "SaaS", "Content", "Marketplace"] as const;
  const geos = ["US", "UK", "DE", "FR", "IT", "ES"] as const;
  const winners = ["A", "B", "C"] as const;

  const now = new Date();
  const baseYear = now.getUTCFullYear() - 1;

  const total = 80;
  for (let i = 1; i <= total; i++) {
    const experimentId = `EXP-${String(i).padStart(4, "0")}`;
    const testName = `Sample test ${i}`;

    const vertical = verticals[i % verticals.length];
    const geo = geos[i % geos.length];

    const month = ((i - 1) % 12) + 1;
    const launched = new Date(isoDate(baseYear, month, ((i - 1) % 27) + 1));
    const concluded = new Date(isoDate(baseYear, month, Math.min(((i - 1) % 27) + 10, 28)));

    await prisma.experiment.upsert({
      where: { experimentId },
      create: {
        experimentId,
        testName,
        vertical,
        geo,
        dateLaunched: launched,
        dateConcluded: concluded,
        winningVar: winners[i % winners.length]
      },
      update: {
        testName,
        vertical,
        geo,
        dateLaunched: launched,
        dateConcluded: concluded,
        winningVar: winners[i % winners.length]
      }
    });
  }

  const count = await prisma.experiment.count();
  await prisma.$disconnect();

  // eslint-disable-next-line no-console
  console.log(`Seed complete. experiments=${count}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


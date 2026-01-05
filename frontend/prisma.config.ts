import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma config relies on DATABASE_URL at config-load time. Prefer `.env.local`,
// falling back to `.env` if present.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});

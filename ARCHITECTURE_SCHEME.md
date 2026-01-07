# CRO Analyst v3 — Architecture Overview

## 1) Runtime Components
- **Next.js (App Router)**: UI pages and API routes live in `frontend/app`. Hosted on Vercel.
- **Postgres (Prisma)**: Canonical `Experiment` table (dates, changeType/element, vertical/geo/brand/metric, winningVar, monthlyExtrap, hypothesis, lessons, screenshots, embeddings).
- **Neo4j**: Graph mirror of experiments with relationships to ChangeType, ElementChanged, Vertical, Geo, Brand, TargetMetric, plus `SIMILAR_TO`.
- **AI services**: LLM for SQL/Cypher generation (with sanitisation); OpenAI for embeddings.
- **Google APIs**: Sheets (experiment data), Drive (screenshots).
- **Vercel Cron**: Calls `/api/import/auto` daily.

## 2) Data Flow
1. **Import**  
   - Manual: `/api/import/sheets` (user OAuth session).  
   - Scheduled: `/api/import/auto` (service account token + `x-internal-api-key`).  
   - Normalise rows (dates/numbers), upsert into Postgres. Optional `IMPORT_LIMIT` or `?limit=` caps rows.
2. **Graph sync**  
   - Postgres experiments mirrored to Neo4j: Experiment → ChangeType / ElementChanged / Vertical / Geo / Brand / TargetMetric, plus `SIMILAR_TO`.
3. **Ask AI**  
   - Auto routes “data” questions to SQL (Postgres) and “relationship” questions to Cypher (Neo4j).  
   - Queries are sanitised (read-only, quoted identifiers, enforced limits, owner rewrites blocked for non-person terms).

## 3) User Flows
- **Stats**: Latest completed month (or latest with data); cards for counts and winners; vertical/geo breakdowns; 3D Neo4j graph; experiments table with pagination.  
- **Experiments list/detail**: Detail shows launchedBy, vertical/geo, dates, winner, monthlyExtrap, screenshots, hypothesis, lessons, Optimizely link, and a graph of similar experiments. Back links respect origin (`from=stats|experiments`).  
- **Graph similarity**: Prefer `SIMILAR_TO`; if <6, add experiments sharing change type/element/vertical/geo/brand/metric (ranked by overlap and monthlyExtrap), up to 6.
- **Ask AI**: Shows generated SQL/Cypher and “Data used”. Hover/click graph nodes to navigate.

## 4) Querying & Safety
- **SQL**: Sanitise with quoted names, limit ≤500, read-only guard, owner-name detection (ignores date/monthly/experiment terms), and `dateConcluded` filters when applicable.  
- **Cypher**: Read-only (MATCH/WITH), block unsafe clauses; use `property IS NOT NULL` checks (no deprecated `exists()`).

## 5) Key Files
- Stats UI/logic: `frontend/app/stats/page.tsx`, graph card `app/stats/Neo4jGraphCard.tsx`.
- Experiments: list/detail under `frontend/app/experiments/`; screenshots `ScreenshotList.tsx`.
- Ask AI: API routes `app/api/ai/ask|query|graph/route.ts`; client `app/components/AskAI.tsx`.
- Imports: `app/api/import/sheets|auto|csv/route.ts`; sheets lib `lib/import/sheetsImport.ts`.
- Neo4j: client `lib/neo4j/client.ts`; sync/helpers inside stats/experiment pages.
- Prisma schema: `prisma/schema.prisma`; config `prisma.config.ts`.

## 6) Auth & Ops
- **Auth**: NextAuth with Google; optional allowlist via `AUTH_ALLOWED_EMAILS`.  
- **Env**: Keep `.env.local` aligned with Vercel (DB URL, Google creds, Neo4j, AI keys, internal API key).  
- **Health**: `/api/health`.  
- **Cron**: Vercel daily cron to `/api/import/auto`.

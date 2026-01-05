# CRO Analyst v3 — Restart Instructions (Blueprint + Improvements)

This document is the **implementation guide** for (re)building the project in `cro-analyst-v3`, using `ARCHITECTURE_SCHEME.md` as the reference architecture while addressing the previous repo’s main cons (security, duplication, and serverless fragility).

Goal: rebuild a clean, maintainable Next.js app with **Postgres as source of truth**, optional **pgvector embeddings**, optional **Neo4j graph analytics**, and an **AI chat** layer that is safe-by-default.

---

## Chosen Defaults (based on your requirements)

These defaults are now assumed throughout the rest of this document:

- **Deployment**: Vercel (serverless / edge where appropriate)
- **Neo4j**: enabled (you have full credentials)
- **Auth**: required for **import** operations (Google Sheets + Drive screenshots); optional for read-only browsing/chat if you want

Implications:
- Long-running work must be implemented as **jobs** (chunked + resumable) and not as one long request.
- Job/progress state must live in **Postgres (source of truth)**, with Redis only as an optional cache.
- Neo4j access must be via **environment variables** (never hardcoded), and GraphRAG must be allowlisted/validated.

---

## Preflight (do this first): pull environment variables from Vercel

Before you run anything locally, pull the environment variables from the existing Vercel project:
`https://vercel.com/nicolalazzarigmailcoms-projects/cro-analyst-v2-new/settings/environment-variables`

Recommended approach (safer + faster than copy/paste):

1. Install Vercel CLI (once): `npm i -g vercel`
2. From the repo root, link the local folder to the Vercel project: `vercel link`
3. Pull env vars into a local file (do not commit this):
   - If you already created the Next.js app under `frontend/`: `vercel env pull frontend/.env.local`
   - If `frontend/` does not exist yet: `vercel env pull .env.local` (move it later)

Notes:
- Treat `.env.local` as secret material: never commit it, never paste it into logs.
- This repo (`cro-analyst-v3`) can start by reusing v2 env vars; later you can create/link a dedicated v3 Vercel project and repeat `vercel env pull`.

## 0) Principles (non‑negotiables)

1. **No unsafe SQL execution**
   - Do not use `prisma.$queryRawUnsafe()` for user-influenced queries.
   - Prefer Prisma query builder (`findMany`, `count`, etc.) or `$queryRaw` with **parameters**.
2. **Structured queries first, LLM last**
   - Use deterministic parsers + a typed intent schema.
   - Only allow LLM-generated SQL/Cypher behind a strict allowlist + validation layer.
3. **Single source of truth for parsing**
   - Date parsing, person/geo/vertical extraction, and query normalization must live in one module and be reused everywhere.
4. **Serverless-safe by design**
   - Any long-running tasks (imports, embeddings, Neo4j sync) must be resumable and not assume a single process lifetime.
5. **Observability and debuggability**
   - Every “retrieval” step should be able to emit: detected filters, executed query (sanitized), row counts, and timings.

---

## 1) Repo Setup (recommended shape)

This repository is the target. Recommended top-level shape:

```
cro-analyst/
  ARCHITECTURE_SCHEME.md
  RESTART_PROJECT_INSTRUCTIONS.md
  docker-compose.yml
  frontend/
    app/
    lib/
    prisma/
```

`ARCHITECTURE_SCHEME.md` and this file should live at the repo root as the starting point.

---

## 1.1 Vercel-Friendly Architecture Notes (important)

Because you’re deploying on Vercel/serverless:

- **No in-memory state** as a source of truth (it will be wiped unpredictably).
- Avoid “background processing inside an API route after returning a response”.
- Prefer a **job queue pattern**:
  - enqueue job (`POST /api/jobs/...`)
  - process job in small batches (`POST /api/jobs/run?jobId=...&cursor=...`)
  - trigger via **Vercel Cron** (or manual “Run now” button in admin UI)
- Keep each batch under typical serverless limits (time/memory). Design jobs to be resumable via cursor/checkpoint.

---

## 2) Milestones (build in vertical slices)

### Milestone A — Foundation (no AI)
- Next.js App Router + TypeScript + Tailwind (optional)
- Prisma + Postgres connection
- Minimal schema: `Experiment`, `Person`, `Team`
- `/api/health` checks DB connectivity
- Basic UI page: list experiments + pagination

Definition of done:
- App runs locally with Docker Postgres
- Experiments list renders reliably

### Milestone B — Import Pipeline (Sheets → Postgres)
- NextAuth Google OAuth (only if required)
- `/api/import` should **enqueue a job** (do not process all rows in one request)
- Worker batches:
  - read Google Sheet rows (paged/chunked)
  - look up Drive media (bounded per batch)
  - upsert into Postgres
  - update job progress in Postgres
- Strict validation of incoming data; store raw strings where needed

Definition of done:
- Import is repeatable and idempotent
- Progress survives server restarts (stored in Postgres)

### Milestone C — Search (keyword only)
- `/api/search`: keyword search over core columns
- Add “filters” support (vertical, geo, person, date range) via deterministic parser

Definition of done:
- Searches are predictable and do not require AI

### Milestone D — Embeddings + Hybrid Retrieval (optional)
- Add pgvector, `embedding vector(1536)`
- `/api/embeddings/generate` implemented as a job (not a single long request)
- `vectorSearch` and `hybridSearch` return stable results

Definition of done:
- Hybrid retrieval works and is measurable (latency, recall)

### Milestone E — Neo4j GraphDB (optional)
- `syncToNeo4j` implemented as a job
- Graph endpoints for patterns/clusters
- GraphRAG only after schema and allowlists are stable

Definition of done:
- Neo4j sync is reproducible and does not block core app

### Milestone F — AI Chat (last)
- Chat UI + `/api/chat/stream` (SSE)
- Retrieval-first: uses Postgres searches + optional Neo4j context
- LLM summarizes/answers; it does not get to execute arbitrary code/queries

Definition of done:
- Chat is helpful, safe, and explainable (shows the query used)

---

## 3) Core Improvements to Implement (vs current repo)

### 3.1 SQL safety (replace “string SQL + unsafe raw”)
Implement a **Query Plan** approach:
- Parse user question → `QueryPlan` (typed)
- Convert `QueryPlan` → Prisma query args (preferred) or parameterized `$queryRaw`

Example `QueryPlan` fields:
- `table: 'experiments'`
- `filters: { vertical?: string; geo?: string; personName?: string; dateRange?: { months?: number; month?: number; year?: number; field: 'launched'|'concluded' } }`
- `sort`, `limit`, `select`

Rules:
- Never interpolate user strings into SQL.
- Use parameter binding for `ILIKE` patterns (e.g. `%${value}%` assembled in code, passed as param).
- Enforce `limit` always for non-aggregate queries.

### 3.1.1 Practical approach on Vercel

To stay safe and simple, prefer this priority order:

1. **Prisma query builder** for most reads (filters, ordering, pagination).
2. If you truly need raw SQL (e.g., pgvector distance), use **`$queryRaw` with parameters**.
3. Avoid LLM-generated SQL entirely for MVP; if you add it later, treat it as “suggested plan” and recompile into a safe query (or run only after strict allowlist validation).

### 3.2 Deterministic date handling (keep the good part)
Keep deterministic parsing for:
- explicit month/year (“October 2025”)
- relative ranges (“last 3 months”)

But implement it once in `frontend/lib/query/parse.ts` (example) and reuse it across:
- `/api/search`
- chat retrieval
- any SQL/Prisma builder

### 3.3 Reduce duplication in retrieval routing
Create a single router function:
- `decideRetrievalMode(question) -> 'postgres' | 'graphdb' | 'hybrid'`
- `retrieveExperiments(question) -> { experiments, executedQueryMeta }`

All endpoints call the same retrieval code.

### 3.4 Jobs instead of long API calls (serverless resilience)
For import/embeddings/neo4j sync:
- Create “job” tables in Postgres: `jobs`, `job_events` (or use a queue service)
- API endpoints enqueue jobs and return `{ jobId }`
- A worker processes jobs (local: node script; prod: queue/worker)

If you want minimal infrastructure:
- Use a cron-like runner or a simple background worker process for local/dev.

### 3.4.1 Vercel jobs: recommended minimal design

Recommended minimal design (no extra infrastructure beyond Postgres + Vercel Cron):

- `POST /api/jobs/import` enqueues an `IMPORT_SHEETS` job with config (sheet id, range, folder id)
- `POST /api/jobs/neo4j-sync` enqueues a `SYNC_NEO4J` job
- `POST /api/jobs/embeddings` enqueues an `EMBEDDINGS` job
- `POST /api/jobs/run` processes **one job batch** and persists a `cursor`/checkpoint in Postgres
- Vercel Cron calls `/api/jobs/run` every minute (or similar)

Job record fields (minimum):
- `id`, `type`, `status`, `createdAt`, `updatedAt`
- `total`, `processed`, `errorsCount`
- `cursor` (JSON) to resume
- `logs`/events stored in `job_events` (append-only)

Security:
- `/api/jobs/*` endpoints require auth (admin role if applicable).

### 3.5 Prompt injection hardening
- Treat LLM output as untrusted.
- If using LLM to produce intent JSON, validate with a schema validator (e.g. `zod`) and reject unknown fields.
- Do not pass secrets or raw DB schema dumps unless necessary; provide minimal schema context.

---

## 4) Suggested Folder Layout (new codebase)

```
frontend/
  app/
    api/
      chat/
      search/
      import/
      jobs/
  lib/
    ai/
      llm.ts               # Anthropic wrapper
      embeddings.ts        # OpenAI embeddings
      answer.ts            # “final answer synthesis” prompts
    db/
      client.ts            # Prisma client
    query/
      parse.ts             # deterministic parsing (geo/vertical/date/person)
      plan.ts              # QueryPlan types + validation
      toPrisma.ts          # QueryPlan -> Prisma args
    jobs/
      enqueue.ts
      worker.ts
```

---

## 5) Security Checklist (ship-gate)

Before enabling AI chat in production:
- All user-influenced DB queries are parameterized (no unsafe raw SQL)
- Hard limits enforced: max rows returned, max timeouts (where possible)
- Strict allowlist for any LLM-generated Cypher (or disable GraphRAG by default)
- Logs do not include secrets or OAuth tokens
- Auth is applied to import/embedding/neo4j-sync job endpoints

---

## 5.1 Auth Requirements (your chosen rule)

Auth is required for:
- Importing from Google Sheets
- Looking up / syncing screenshots from Google Drive (and any Drive proxy endpoints)
- Enqueuing/running background jobs

Auth can be optional for:
- Browsing experiments
- Read-only search
- Chat (unless you want per-user history; then require auth for history, not for answering)

---

## 6) Migration Notes (if you keep any old code)

If you copy parts from the current repo:
- Copy **schema** and **deterministic parsing ideas**, but refactor to:
  - remove direct SQL string building with interpolated values
  - remove duplicate date logic across multiple functions
- Copy docs and test questions (e.g. `SQL_GENERATOR_TEST_QUESTIONS.md`) as acceptance criteria.

---

## 7) Recommended First Task List (exact next steps)

1. Create new Next.js app in `frontend/`
2. Add `docker-compose.yml` (Postgres+pgvector, Redis, Neo4j optional)
3. Add Prisma schema with `Experiment/Person/Team`
4. Add `/api/health`
5. Build experiments list page
6. Implement deterministic `parse.ts` + Prisma-based search
7. Only after that, add chat streaming with retrieval-first behavior

---

## 8) Milestone A “File Checklist” (actionable starter)

Create these files first:

- `docker-compose.yml` (local dev: Postgres+pgvector, Redis optional, Neo4j)
- `frontend/package.json` (Next.js app)
- `frontend/prisma/schema.prisma` (Experiment/Person/Team minimal)
- `frontend/lib/db/client.ts` (Prisma client)
- `frontend/app/api/health/route.ts` (checks DB)
- `frontend/app/experiments/page.tsx` (renders list)
- `frontend/app/api/experiments/route.ts` (paginated read endpoint)

Minimum Experiment fields to include at start:
- `id`, `experimentId`, `testName`, `vertical`, `geo`, `dateLaunched`, `dateConcluded`, `winningVar`

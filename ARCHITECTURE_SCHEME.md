# CRO Analyst v2 — How It Works (Architecture Scheme)

This repo is a **single Next.js app** (`frontend/`) that serves both the UI and the “backend” API routes.
It integrates **Postgres (+ pgvector)** for structured data + embeddings, **Neo4j** for graph analytics/GraphRAG, **Redis** for caching/progress/history, and external AI + Google APIs.

---

## 1) System Components (at runtime)

```
Browser (Next.js UI)
  │
  ├─▶ Next.js App Router (UI pages + API routes)  [frontend/app]
  │     │
  │     ├─▶ PostgreSQL (experiments/people/teams + vector embeddings)  [Prisma]
  │     ├─▶ Redis (conversation history, import/embedding progress, caching)
  │     ├─▶ Neo4j (graph model + Cypher queries + GraphRAG)
  │     ├─▶ Anthropic (LLM for chat + intent/SQL/Cypher generation)
  │     ├─▶ OpenAI (embeddings)
  │     └─▶ Google APIs (Sheets import + Drive media lookup)
  │
Docker services (local dev): Postgres + Redis + Neo4j  [docker-compose.yml]
```

Key integration points:
- **DB access**: `frontend/lib/db/client.ts` (Prisma client + query capture)
- **Redis**: `frontend/lib/redis/client.ts`
- **Neo4j**: `frontend/lib/graphdb/client.ts`
- **Anthropic LLM**: `frontend/lib/ai/llm.ts`
- **OpenAI embeddings**: `frontend/lib/ai/embeddings.ts`

---

## 2) Core Data Model

### PostgreSQL (Prisma)
Defined in `frontend/prisma/schema.prisma`:
- `experiments` (main table; many TEXT columns, dates stored as TEXT `DD/MM/YYYY`, optional `embedding vector(1536)`)
- `people` and `teams` (ownership metadata)
- NextAuth tables (`users`, `sessions`, `accounts`, …) if adapter is enabled (currently JWT-only by default)

### Neo4j (GraphDB)
Synced from Postgres via `frontend/lib/graphdb/sync.ts`.
Neo4j stores:
- Experiment nodes + dimension nodes (Vertical, Geo, Brand, Lever, MasterLever, …)
- Relationships like `(:Experiment)-[:IN_VERTICAL]->(:Vertical)`

---

## 3) Main User Flows (Sequence Schemes)

### A) Chat / “Ask the database”
Entry points:
- Non-streaming: `frontend/app/api/chat/route.ts`
- Streaming (SSE): `frontend/app/api/chat/stream/route.ts`

Scheme:
```
UI (chat page) ─▶ /api/chat(/stream)
   │
   ├─▶ auth() (optional) + conversation history (Redis → in-memory fallback)
   ├─▶ getGraphContextForQuestion() (optional Neo4j context injection)
   └─▶ processChatMessage()  [frontend/lib/ai/chat.ts]
         │
         ├─▶ If graph-shaped question:
         │     ├─ pattern queries / GraphRAG → Neo4j Cypher  [frontend/lib/ai/graphContext.ts]
         │     └─ fetch selected experiment IDs back from Postgres (for full rows)
         │
         ├─▶ Else if DB search is needed:
         │     └─ generateAndExecuteSQL()
         │           ├─ deterministic date/person parsing (month/year, last N months)
         │           ├─ optional LLM “intent JSON” → SQL builder
         │           ├─ fallback LLM SQL generation (validated)
         │           └─ prisma.$queryRawUnsafe(sql)
         │         [frontend/lib/ai/sql-generator.ts]
         │
         └─▶ LLM answer synthesis (Anthropic) using retrieved experiments/context
```

Notes about SQL generation:
- The generator explicitly **bypasses the LLM** for queries containing **explicit month+year** or **relative date ranges** (“last N months”) to keep output deterministic and correct.
- SQL safety checks are done in `validateSQL()` before execution.

### B) Unified Search (keyword vs AI vs GraphDB)
Entry point: `frontend/app/api/experiments/search/route.ts`

Scheme:
```
UI Search box ─▶ /api/experiments/search?q=...
  ├─ easy: /api/search (hybrid keyword + vector)  [frontend/app/api/search/route.ts]
  ├─ ai: return "useStreaming=true" and UI calls /api/chat/stream
  └─ graphdb: call /api/graphdb/* endpoints (patterns/clusters/predictions/...)
```

Hybrid (pgvector + keywords) search is implemented in:
- `frontend/lib/ai/rag.ts` (`vectorSearch()` + `hybridSearch()`)

### C) Import (Google Sheets → Postgres → Neo4j)
Entry point: `frontend/app/api/import/route.ts`

Scheme:
```
UI Import page ─▶ /api/import (POST)
  ├─ auth() (requires Google OAuth session)
  ├─ Google Sheets read (rows) + Google Drive lookup (media URLs)
  ├─ Upsert into Postgres (experiments/people/teams)
  ├─ Progress updates (Redis → in-memory fallback)  [frontend/lib/import-progress.ts]
  └─ syncToNeo4j() to refresh graph model  [frontend/lib/graphdb/sync.ts]
```

### D) Embeddings (Postgres rows → OpenAI → pgvector column)
Entry point: `frontend/app/api/embeddings/generate/route.ts`

Scheme:
```
UI Embeddings page ─▶ /api/embeddings/generate (POST)
  ├─ auth() (required)
  ├─ Load all TEXT columns from information_schema (dynamic)
  ├─ Build one big text per experiment
  ├─ OpenAI embeddings API  [frontend/lib/ai/embeddings.ts]
  ├─ UPDATE experiments.embedding = $vector
  └─ Progress updates (Redis → in-memory fallback)  [frontend/lib/embedding-progress.ts]
```

### E) GraphDB Insights (direct Cypher + GraphRAG)
Entry points: `frontend/app/api/graphdb/*/route.ts`

Two main modes:
- **Direct Cypher endpoints** (patterns, clusters, influence-chain, predictions, etc.)
- **GraphRAG** (LLM generates Cypher based on schema; see `frontend/lib/graphdb/graphRAG.ts` and `frontend/lib/graphdb/langchainGraphRAG.ts`)

---

## 4) Key Directories (mental map)

- `frontend/app/…` — Next.js pages + API routes (`route.ts`)
- `frontend/lib/ai/…`
  - `chat.ts` — main orchestration for chat + retrieval + answer generation
  - `sql-generator.ts` — deterministic + LLM-assisted SQL generation + execution
  - `rag.ts` — pgvector + keyword hybrid retrieval
  - `graphContext.ts` — decides when/how to query Neo4j for context
  - `llm.ts` — Anthropic client wrapper
- `frontend/lib/graphdb/…`
  - `sync.ts` — Postgres → Neo4j sync
  - `queries.ts` — reusable Cypher query functions
  - `graphRAG.ts` / `langchainGraphRAG.ts` — Cypher generation via LLM
- `frontend/prisma/schema.prisma` — source of truth for Postgres schema
- `docker-compose.yml` — Postgres (pgvector) + Redis + Neo4j local stack

---

## 5) Where to Start Reading (practical)

- Chat end-to-end: `frontend/app/api/chat/route.ts` → `frontend/lib/ai/chat.ts`
- SQL generation: `frontend/lib/ai/sql-generator.ts`
- Hybrid vector search: `frontend/app/api/search/route.ts` → `frontend/lib/ai/rag.ts`
- Import: `frontend/app/api/import/route.ts`
- Neo4j sync + queries: `frontend/lib/graphdb/sync.ts`, `frontend/lib/graphdb/queries.ts`


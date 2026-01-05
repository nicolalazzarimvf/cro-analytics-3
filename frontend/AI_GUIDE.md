# AI Query Pipeline – Guide for CRO Analyst

This outlines how we convert natural-language questions into Postgres-backed answers with LLM summarisation. It’s written to keep the system explainable, safe, and fast.

## Model choice
- Primary: Claude 3.5 Sonnet (balance of reasoning + cost). Alternate: GPT-4o (best quality) or GPT-4o-mini (cheap).
- Use a single model for both SQL generation and summarisation initially; split later if needed.

## Data + schema
- Source of truth: Postgres `Experiment` table (all CSV columns imported).
- Add/read indexes: `dateConcluded`, `dateLaunched`, `vertical`, `geo`, `brand`, `testName`, `winningVar`.

## Backend flow (`/api/ai/query`)
1) Input: `{ question: string }`.
2) Guardrails: reject empty/malicious prompts; enforce read-only queries.
3) SQL generation prompt to LLM:
   - Provide explicit schema/columns + types.
   - Require JSON `{ "sql": "...", "notes": "...", "limit": <int|optional> }`.
   - Enforce SELECT-only; no writes/DDL; add `LIMIT 500` if absent.
   - Default date window (e.g., last 12 months) when user gives none; explain in `notes`.
4) Validate SQL locally:
   - Must start with SELECT; forbid `INSERT|UPDATE|DELETE|DROP|ALTER`.
   - Forbid `;` in the middle; clamp LIMIT ≤ 1000.
5) Execute via Prisma `$queryRawUnsafe(sql)` after validation.
6) Summarise with LLM:
   - Inputs: question, SQL, notes, up to N rows (e.g., 50) and row count.
   - Output structure: `answer` (concise), `highlights` (bullets), `dataWindow/filters used`, `nextTests` suggestions, and mention if truncated.
7) Response payload: `{ answer, highlights, rows: [...], rowCount, truncated, sql, notes }`.

## Frontend (Stats page)
- Add an “Ask the data” form at top.
- On submit: POST to `/api/ai/query`, show loader; render answer + highlights; collapsible “Data used” table + SQL.
- Handle empty results with a helpful hint to adjust filters.

## Safety + UX
- Always show the SQL used (for transparency).
- Cap rows returned to the UI (e.g., 200) and to the LLM (e.g., 50).
- If no results, return a friendly message and suggested rephrasing.

## Env/config
- `AI_PROVIDER` = `claude` | `openai`.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
- `AI_MODEL` (override default).

## Future enhancements
- Add embeddings/RAG on text fields (testName, hypothesis, lessons) for fuzzy matching.
- Optional Neo4j pathing only if we need graph-style insights; otherwise stick to SQL for simplicity.
- Add cached “canonical queries” for common questions. 

---

## Progress log (latest work)
- Added unified ask endpoint `/api/ai/ask`: classifies intent (SQL vs Graph), runs the chosen path, falls back to the other if no data, then summarizes with the LLM into a single answer. Enforces SELECT-only SQL, read-only Cypher, interval/round/date_sub normalization, and graph stddev -> stdev normalization.
- Frontend Ask panel now calls `/api/ai/ask`, shows one combined answer, and collapses source details; graph responses include bar + mini graph visualization (changeType → elementChanged).
- Graph sync: Neo4j stores Experiment nodes with Vertical/Geo/Brand/TargetMetric/ChangeType/ElementChanged relationships and key props (monthlyExtrap, metrics, hypothesis, lessonLearned, etc.). Sync via `npm run neo4j:sync -- 0`.
- Embeddings: all experiments embedded into Postgres pgvector; import auto-upserts CSV rows and can embed missing rows (scripts: `ai:embed`, `ai:embed:all`).
- Guardrails: middleware allows `/api/ai/ask`, `/api/ai/query`, `/api/ai/graph`; read-only SQL/Cypher enforced; stddev normalization in graph endpoint to avoid Neo4j function errors.
- Ports: dev server sometimes binds to 3002 if 3000 is blocked; prefer the port printed by `npm run dev` unless 3000 is free.

### Current usage tips
- Use Auto mode in the Ask panel; the system will pick SQL or Graph and summarize with the LLM. Graph-heavy intents (co-occurrence/relationships) still available via the Graph toggle.
- If port 3000 is blocked, run on the port Next prints (e.g., 3002) or free 3000 and restart.
- For graph-heavy questions, avoid stddev; the endpoint now normalizes stddev → stdev, but simpler co-occurrence questions work best.

### Pending/ideas
- Improve classifier and prompt to reduce SQL misgeneration (e.g., date_sub, mysqlisms).
- Tighten graph result pruning (unknown/other buckets) and highlight higher-signal patterns.
- Optional: auto-run both paths when classifier confidence is low and merge with a single LLM pass (already partially done in `/api/ai/ask`).

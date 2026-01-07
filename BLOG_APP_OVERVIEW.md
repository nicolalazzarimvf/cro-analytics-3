# MVF CRO Analyst — Deep Product & Architecture Overview

## 1) Product: what it is and why it exists
- **Purpose:** Give teams one live, trustworthy place to see CRO experiments, winners, and patterns that can be reused.
- **How it helps:** 
  - Fast answers: browse stats, drill any experiment, or ask questions in plain English.
  - Pattern finding: Neo4j graph shows which change types/elements/verticals/geos connect, so you can spot repeatable wins.
  - Transparency: every AI answer shows the SQL/Cypher used, so analysts can trust, verify, or reuse queries.

## 2) User journeys
- **Stay informed (Stats):** 
  - Auto-selects the latest completed month (or the most recent with data).
  - Cards for experiments run/concluded/launched, top winners (by monthly extrap or count), vertical/geo breakdowns, and a 3D graph.
  - Pagination appears only on the experiments table (not between the card grids).
- **Drill any experiment (Detail page):**
  - Shows launched by, vertical, geo, dates, winner, monthly extrap, screenshots, hypothesis, lessons learned, Optimizely link.
  - Graph of similar experiments: SIMILAR_TO first, then fall back to overlap on change types/elements/vertical/geo/brand/metric (ranked by overlap + impact, up to 6).
  - Back links remember whether you came from stats or experiments.
- **Ask in plain English (Ask AI):**
  - Auto-picks SQL vs Graph; SQL hits Postgres, Graph hits Neo4j.
  - Queries are sanitised (read-only, quoted identifiers, enforced limits, safe owner rewrites) and shown to the user.
  - “Data used” shows the rows returned; summaries are built from live data.

## 3) Data flow (ingestion → storage → graph)
- **Source of truth:** Live Google Sheet (range A:ZZ, gid configurable).
- **Ingestion paths:** 
  - Manual: `/api/import/sheets` (user session).
  - Scheduled: `/api/import/auto` (service account token + internal API key), triggered by Vercel cron (daily).
- **Normalization:** Coerce dates/numbers, trim text, upsert into Postgres via Prisma. Store: dates, outcomes, change types, elements, screenshots, extrapolated revenue, vector embeddings.
- **Graph mirror:** Sync experiments into Neo4j with relationships to ChangeType, ElementChanged, Vertical, Geo, Brand, TargetMetric. Similarity from SIMILAR_TO; fallback similarity built from shared change types/elements/vertical/geo/brand/metric (ranked).
- **Limits:** Optional `IMPORT_LIMIT` env or `?limit=` to cap rows; otherwise full sheet.

## 4) Application model (data + AI)
- **Postgres (canonical):** `Experiment` table with hypothesis, lessons, winningVar, monthlyExtrap, changeType/element/vertical/geo/brand/metric, screenshots, embeddings. Prisma over SSL.
- **Neo4j (relationships):** Used for graph insights and similar-experiment discovery. Colors in the UI: orange cube (focal), blue (change type), green (element), purple (vertical/geo/brand/metric), gray (similar experiments).
- **Similarity rules:** 
  - Use SIMILAR_TO if present.
  - If fewer than 6, add experiments that overlap on change type/element/vertical/geo/brand/metric, ranked by overlap and monthly extrapolation.
- **Ask AI engine:** 
  - LLM proposes SQL/Cypher; we sanitise (read-only, quoted IDs, enforce limits, block non-person owner rewrites like “monthly/date/experiment”).
  - SQL goes to Postgres; Graph questions go to Neo4j.
  - Show the generated query and “Data used” with the answer.

## 5) UI details
- **Header nav:** Stats (first), Experiments, How it works. Admin removed from nav.
- **Stats page:** Clean card grids; pagination only on the experiments table (top/bottom). Graph shows patterns plus similar experiments; legend notes why gray nodes might be missing (no relationships yet).
- **Experiment page:** 
  - “Launched by” full row; Vertical + Geo share a row.
  - Optimizely “View” link when available.
  - Graph shows this experiment’s relationships and similar experiments (same similarity rules as stats).
- **Graph rendering:** Single shared Three.js instance with `react-force-graph-3d` to avoid duplicate imports. Hover shows ID/title; click opens experiment.

## 6) Auth, security, operations
- **Auth:** NextAuth with Google; optional allowlist via `AUTH_ALLOWED_EMAILS`. With the allowlist set, only listed addresses are allowed.
- **API auth:** Internal key for scheduled imports (`x-internal-api-key` + `GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN`).
- **Cron:** Vercel daily cron calls `/api/import/auto`.
- **Health:** `/api/health`; server logs in Vercel; Prisma/Neo4j warn on SSL/connectivity.
- **Environments:** Keep `.env.local` aligned with Vercel (DB URL, Google creds, Neo4j, AI keys).

## 7) Tech stack
- Next.js (App Router), Postgres + Prisma, Neo4j, `react-force-graph-3d` (Three.js), NextAuth (Google), Vercel hosting/cron, LLM-based SQL/Cypher generation with sanitisation.

## 8) Why it matters (impact)
- **Trustworthy source:** One live place for all experiments, not stale slides or scattered sheets.
- **Actionable patterns:** Graph lens highlights repeatable winning changes and where they might generalise across verticals/geos.
- **Speed:** PMs/analysts get answers without writing SQL/Cypher; engineers get transparent queries and clear data contracts.

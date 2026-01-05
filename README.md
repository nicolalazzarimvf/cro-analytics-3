# CRO Analyst v3

Production Next.js app (App Router) for browsing and analyzing A/B experiments, with monthly “Top winner” spotlight, Neo4j graph context, experiment search/listing, and admin import flows (Google Sheets/CSV/auto cron).

## Stack
- Next.js 15 (App Router) + React 19
- Prisma 7 + PostgreSQL
- Neo4j Data API (graph neighborhood cards)
- NextAuth (Google OAuth)
- TailwindCSS (custom theme)

## Quick start
```bash
cd frontend
cp .env.local.example .env.local   # ensure all env vars are set
npm install
npm run build    # or npm run dev
```
Key envs (set in `.env.local` / Vercel):
- `DATABASE_URL` (Postgres)
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATA_API_URL`, `NEO4J_DATABASE`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_RANGE`, `GOOGLE_SHEETS_GID`
- `OPENAI_API_KEY` (and AI provider configs)
- `NEXT_PUBLIC_APP_URL`

Prisma:
```bash
cd frontend
npm run prisma:generate
npm run prisma:migrate   # for dev
```

## Running
```bash
cd frontend
npm run dev    # local dev
npm run build && npm run start   # production mode
```

## Deploy
Project is configured for Vercel:
- `vercel.json` includes a cron calling `/api/import/auto`.
- `npm run build` runs `prisma generate` via the `prebuild` hook.

Deploy command (already aliased to `cro-analyst-v3.vercel.app`):
```bash
cd frontend
vercel --prod
```

## Notes
- The Neo4j graph card renders the top winner’s neighborhood plus similar experiments.
- Admin import pages support CSV/Sheets and a scheduled cron import.
- Authentication is email-allowlisted; adjust `AUTH_ALLOWED_EMAILS` as needed.

Auto-deploy test on Mon Jan  5 15:30:50 CET 2026

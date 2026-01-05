"use client";

import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto mt-10 flex max-w-5xl flex-col gap-6 px-6 pb-16">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">How it works</p>
        <h1 className="text-3xl font-bold text-gray-900">Inside MVF CRO Analyst</h1>
        <p className="text-base text-gray-700">
          A deep dive into how data flows from Google Sheets and the database to the UI, AI summaries, and
          the Neo4j experiment graph.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">Data ingestion</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Sources:</strong> We pull from the live Google Sheet (range A:ZZ, gid configurable) via{" "}
            <code>/api/import/sheets</code> (user session) and <code>/api/import/auto</code> (service account / cron).
          </li>
          <li>
            <strong>Auth:</strong> Google OAuth for interactive imports; service account bearer token for scheduled
            imports (header <code>x-internal-api-key</code> + <code>GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN</code>).
          </li>
          <li>
            <strong>Processing:</strong> Rows are normalized, coerced to dates/numbers, and upserted into Postgres
            via Prisma. Screenshot URLs, extrapolated revenue, and vector embeddings are stored when present.
          </li>
          <li>
            <strong>Limits:</strong> Optional <code>IMPORT_LIMIT</code> env or <code>?limit=</code> query controls row
            count; otherwise full sheet is ingested.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">Application model</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Database:</strong> Postgres holds the canonical <code>Experiment</code> table with dates, outcomes,
            metrics, change types, elements, and screenshot links. Prisma adapter uses pooled SSL connections.
          </li>
          <li>
            <strong>Search & AI:</strong> Free-text queries embed the question, hit vector similarities (when enabled),
            and ask the LLM to produce SQL. SQL is sanitized (quoted identifiers, read-only, forced limits) before
            execution.
          </li>
          <li>
            <strong>Graph:</strong> Experiments are mirrored in Neo4j with relationships to ChangeType, ElementChanged,
            Vertical, Geo, Brand, and TargetMetric. We pull the winner&apos;s neighborhood and nearest similar
            experiments (via <code>SIMILAR_TO</code> or shared change types).
          </li>
          <li>
            <strong>AuthN/AuthZ:</strong> NextAuth with Google; optional allowlist via <code>AUTH_ALLOWED_EMAILS</code>.
            API routes reuse session tokens for Google calls when needed.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">UI behaviors</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Stats:</strong> Shows last completed month (or most recent data), top winners, geo/vertical breakdowns,
            and the Neo4j 3D graph. Pagination controls appear above and below the experiments table.
          </li>
          <li>
            <strong>Experiments:</strong> Listing with search/filter and detail pages. Back links remember whether you
            came from stats or experiments.
          </li>
          <li>
            <strong>Graph UI:</strong> Single Three.js instance is shared with <code>react-force-graph-3d</code> to avoid
            duplicate imports. Orange cube marks the focal experiment; colors map to change type (blue), element (green),
            vertical/geo/brand/metric (purple), similar experiments (gray).
          </li>
          <li>
            <strong>Ask AI:</strong> Auto mode chooses SQL vs graph; shows animated “Thinking…” while fetching, and
            exposes the generated SQL/Cypher for transparency.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">Operational notes</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Cron:</strong> Vercel cron (daily) calls <code>/api/import/auto</code>. Requires{" "}
            <code>GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN</code> and <code>AI_INTERNAL_API_KEY</code>.
          </li>
          <li>
            <strong>Env sync:</strong> Keep <code>.env.local</code> aligned with Vercel envs (DB URL, Google creds, Neo4j,
            AI keys).
          </li>
          <li>
            <strong>Error handling:</strong> Import endpoints log errors and return JSON with messages. Graph fallbacks
            include defensive defaults for missing properties (e.g., geo codes).
          </li>
          <li>
            <strong>Diagnostics:</strong> Use <code>/api/health</code> for a quick readiness check; Vercel logs for server
            exceptions; Prisma/Neo4j clients log warnings in case of SSL or connection issues.
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
          <Link href="/stats" className="text-brand-700 hover:underline">
            View stats
          </Link>
          <span className="text-gray-400">•</span>
          <Link href="/experiments" className="text-brand-700 hover:underline">
            Browse experiments
          </Link>
          <span className="text-gray-400">•</span>
          <Link href="/admin/import" className="text-brand-700 hover:underline">
            Import data
          </Link>
        </div>
      </section>
    </main>
  );
}

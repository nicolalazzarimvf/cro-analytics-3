"use client";

import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto mt-10 flex max-w-5xl flex-col gap-6 px-6 pb-16">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">How it works</p>
        <h1 className="text-3xl font-bold text-gray-900">Inside MVF CRO Analyst</h1>
        <p className="text-base text-gray-700">
          Your single place to see what we tested, what won, and how similar ideas connect. CRO Analyst ingests
          our live experiment data, keeps it fresh automatically, and gives you quick answers and visual context.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">What you can do</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>Browse stats for the latest month: top winners, vertical/geo breakdowns, and a 3D graph of patterns.</li>
          <li>Drill into any experiment: who launched it, what changed, screenshots, results, and similar experiments.</li>
          <li>Ask natural-language questions: pull tables or graph insights without writing SQL/Cypher.</li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">How data stays fresh</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            Live Google Sheet → CRO Analyst: the sheet is imported automatically on a schedule and can be refreshed
            manually from the app.
          </li>
          <li>
            Data is cleaned and stored in Postgres (dates, outcomes, change types, screenshots, extrapolation, embeddings).
          </li>
          <li>
            Experiments are mirrored into Neo4j so we can surface relationships (change type, element, vertical, geo, brand, metric).
          </li>
          <li>
            Ask AI uses the same fresh data; nothing is cached in the browser.
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
        <h2 className="text-xl font-semibold text-gray-900">How Ask AI works</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>For data questions, we generate SQL, sanitize it (read-only, quoted, limited), and run it on Postgres.</li>
          <li>For relationship questions, we generate Cypher to query Neo4j and return patterns (change type → element, etc.).</li>
          <li>We show the SQL/Cypher used so you can trust and reuse the query.</li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <h2 className="text-xl font-semibold text-gray-900">Technical details (for admins)</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>
            <strong>Imports:</strong> <code>/api/import/sheets</code> (user session) and <code>/api/import/auto</code> (service account + cron).
            Optional <code>IMPORT_LIMIT</code> or <code>?limit=</code> caps rows; range A:ZZ, gid configurable.
          </li>
          <li>
            <strong>Auth:</strong> NextAuth with Google; optional allowlist via <code>AUTH_ALLOWED_EMAILS</code>. Service calls use{" "}
            <code>x-internal-api-key</code> + <code>GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN</code>.
          </li>
          <li>
            <strong>Database:</strong> Prisma on Postgres (SSL). <code>Experiment</code> holds dates, outcomes, change types, elements, screenshots, extrapolation, embeddings.
          </li>
          <li>
            <strong>Graph:</strong> Experiments in Neo4j linked to ChangeType, ElementChanged, Vertical, Geo, Brand, TargetMetric.
            Similar experiments from <code>SIMILAR_TO</code> or overlap on change types/elements/vertical/geo/brand/metric.
          </li>
          <li>
            <strong>Ops:</strong> Vercel cron (daily) hits <code>/api/import/auto</code>; <code>/api/health</code> for readiness; errors surface in Vercel logs.
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

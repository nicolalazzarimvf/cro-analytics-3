"use client";

import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto mt-10 flex max-w-5xl flex-col gap-6 px-6 pb-16">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">How it works</p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Inside MVF CRO Analyst</h1>
        <p className="text-base text-gray-700 dark:text-gray-300">
          Your single place to see what we tested, what won, and how similar ideas connect. CRO Analyst ingests
          our live experiment data, keeps it fresh automatically, and gives you quick answers and visual context.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">What you can do</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>Browse stats for the latest month: top winners, vertical/geo breakdowns, and a 3D graph of patterns.</li>
          <li>Drill into any experiment: who launched it, what changed, screenshots, results, and similar experiments.</li>
          <li>Ask natural-language questions: pull tables or graph insights without writing SQL/Cypher.</li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">How data stays fresh</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            Live Google Sheet → CRO Analyst: the sheet is imported automatically on a schedule and can be refreshed
            manually from the app.
          </li>
          <li>
            Data is cleaned and stored in Postgres (dates, outcomes, change types, screenshots, extrapolation, embeddings).
          </li>
          <li>
            Graph relationships (change type, element, vertical, geo, brand, metric, similar experiments) are computed
            directly from Postgres — no external graph database needed.
          </li>
          <li>
            Ask AI uses the same fresh data; nothing is cached in the browser.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">UI behaviors</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            <strong>Stats:</strong> Shows last completed month (or most recent data), top winners, geo/vertical breakdowns,
            and a 3D relationship graph. Pagination controls appear above and below the experiments table.
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
            <strong>Ask AI:</strong> Auto mode chooses SQL vs graph pattern analysis; shows animated "Thinking…" while fetching, and
            exposes the generated SQL for transparency.
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">How Ask AI works</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>For data questions, we generate SQL, sanitize it (read-only, quoted, limited), and run it on Postgres.</li>
          <li>For relationship/pattern questions, we aggregate data from Postgres (change type → element, etc.) and visualise them.</li>
          <li>We show the SQL used so you can trust and reuse the query.</li>
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Technical details (for admins)</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
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
            <strong>Graph:</strong> Experiment relationships (change type, element, vertical, geo, brand, metric) and similarity
            are computed from Postgres. Similar experiments are ranked by attribute overlap count and monthly impact.
          </li>
          <li>
            <strong>Ops:</strong> Vercel cron (daily) hits <code>/api/import/auto</code>; <code>/api/health</code> for readiness; errors surface in Vercel logs.
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
          <Link href="/stats" className="text-blue-600 dark:text-blue-400 hover:underline">
            View stats
          </Link>
          <span className="text-gray-400 dark:text-gray-500">•</span>
          <Link href="/experiments" className="text-blue-600 dark:text-blue-400 hover:underline">
            Browse experiments
          </Link>
          <span className="text-gray-400 dark:text-gray-500">•</span>
          <Link href="/admin/import" className="text-blue-600 dark:text-blue-400 hover:underline">
            Import data
          </Link>
        </div>
      </section>
    </main>
  );
}

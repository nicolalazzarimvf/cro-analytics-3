"use client";

import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto mt-10 flex max-w-5xl flex-col gap-6 px-6 pb-16">
      {/* Hero */}
      <header className="mb-4">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          How it works
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-gray-500 dark:text-gray-400">
          CROmatic ingests live experiment data, builds a knowledge graph of relationships, and uses AI to surface
          insights — so you can learn faster from every test your team runs.
        </p>
      </header>

      {/* What you can do */}
      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">What you can do</h2>
        <div className="grid gap-4 sm:grid-cols-2 text-sm text-gray-700 dark:text-gray-300">
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-violet-500 mb-1">Stats</div>
            <p>KPI dashboard with 12-month trends, win rate, revenue impact, vertical/geo breakdowns, and AI-powered Q&A over the data.</p>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-500 mb-1">Experiments</div>
            <p>Full listing with search and filters. Drill into any test: hypothesis, screenshots, outcome, similar experiments.</p>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-500 mb-1">Knowledge Graph</div>
            <p>Interactive 3D visualisation of every experiment and its attributes. Toggle layers to reveal clusters and patterns across the programme.</p>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-1">Ask AI</div>
            <p>Ask natural-language questions. The AI generates SQL, queries the data, analyses graph patterns, and returns a detailed written answer with tables and charts.</p>
          </div>
        </div>
      </section>

      {/* Data pipeline */}
      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">How data stays fresh</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            <strong>Google Sheets → CROmatic:</strong> the live experiment tracker is imported automatically on a daily schedule (Vercel cron) and can be refreshed manually from the home page.
          </li>
          <li>
            <strong>Clean &amp; store:</strong> data is normalised and stored in Postgres — dates, outcomes, change types, screenshots, monthly extrapolation, and vector embeddings.
          </li>
          <li>
            <strong>Graph relationships:</strong> change type, element, vertical, geo, brand, and metric connections are computed on-the-fly from Postgres — no external graph database needed.
          </li>
          <li>
            <strong>Always live:</strong> Ask AI, the Knowledge Graph, and all dashboards query the same up-to-date source. Nothing is browser-cached.
          </li>
        </ol>
      </section>

      {/* How Ask AI works */}
      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">How Ask AI works</h2>
        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-3">
          <p>
            When you type a question, CROmatic runs <strong>three parallel data pipelines</strong>:
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong>SQL query generation:</strong> An LLM translates your question into a safe, read-only SQL query, executes it against Postgres, and returns structured rows.
            </li>
            <li>
              <strong>Graph pattern analysis:</strong> The system aggregates change type → element relationships and identifies the most frequent patterns relevant to your question.
            </li>
            <li>
              <strong>Individual experiment sampling:</strong> A sample of matching experiments (with their attributes and outcomes) is sent to the LLM for richer context.
            </li>
          </ol>
          <p>
            All three data sources are combined and fed to a Claude model (Anthropic) that produces a detailed, data-driven analysis — including executive summary, key highlights, detailed learnings, recommended next steps, and patterns.
          </p>
          <p>
            The generated SQL is displayed so you can <strong>verify and reuse</strong> the query.
          </p>
        </div>
      </section>

      {/* AI quality */}
      <section className="space-y-3 rounded-2xl border border-violet-200 dark:border-violet-800/60 bg-violet-50 dark:bg-violet-900/10 p-6 shadow-sm dark:shadow-none">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-violet-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Continuous AI quality improvement</h2>
        </div>
        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
          <p>
            An <strong>automated AI evaluation suite</strong> (powered by OpenAI GPT as an independent judge) runs every week against a curated set of benchmark questions.
            Each response is scored across multiple dimensions — factual accuracy, data coverage, actionability, and formatting.
          </p>
          <p>
            Results are tracked over time and used to fine-tune the system prompt, data pipelines, and model parameters.
            This means response quality <strong>improves continuously</strong> without requiring manual intervention — the AI gets
            smarter about your CRO programme with every evaluation cycle.
          </p>
        </div>
      </section>

      {/* Knowledge Graph explained */}
      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Knowledge Graph</h2>
        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
          <p>
            The Knowledge Graph page renders <strong>every experiment</strong> as a node, connected to its attributes — change type, element changed, vertical, geo, and brand. The result is a 3D network where:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Clusters</strong> reveal which change types and elements are tested most often together.</li>
            <li><strong>Orange nodes</strong> highlight winning experiments, making it easy to spot successful patterns.</li>
            <li><strong>Toggle layers</strong> to isolate specific dimensions — e.g. show only verticals to see how testing focus differs across markets.</li>
            <li><strong>Click any experiment</strong> to jump straight to its detail page with full context.</li>
          </ul>
        </div>
      </section>

      {/* Technical details */}
      <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Technical details</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            <strong>Stack:</strong> Next.js (App Router) + Tailwind CSS + Prisma + Postgres + Anthropic Claude + react-force-graph-3d (Three.js).
          </li>
          <li>
            <strong>Imports:</strong> Daily Vercel cron → <code>/api/import/auto</code> (Google service account). Manual trigger from home page.
          </li>
          <li>
            <strong>Auth:</strong> NextAuth with Google OAuth. Optional email allowlist via <code>AUTH_ALLOWED_EMAILS</code>.
          </li>
          <li>
            <strong>Graph engine:</strong> All relationships computed from Postgres at query time. Similar experiments ranked by attribute overlap + monthly revenue impact.
          </li>
          <li>
            <strong>AI evals:</strong> Weekly automated eval suite (OpenAI GPT as independent judge) benchmarks response quality across accuracy, coverage, and actionability. Results feed back into prompt and pipeline improvements.
          </li>
        </ul>
      </section>

      {/* Quick links */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
          <Link href="/stats" className="text-blue-600 dark:text-blue-400 hover:underline">
            Dashboard
          </Link>
          <span className="text-gray-400 dark:text-gray-500">•</span>
          <Link href="/experiments" className="text-blue-600 dark:text-blue-400 hover:underline">
            Experiments
          </Link>
          <span className="text-gray-400 dark:text-gray-500">•</span>
          <Link href="/graph" className="text-blue-600 dark:text-blue-400 hover:underline">
            Knowledge Graph
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

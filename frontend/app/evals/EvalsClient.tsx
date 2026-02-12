"use client";

import { Fragment, useEffect, useState } from "react";

type EvalResult = {
  id: number;
  input: string;
  ideal: string;
  category: string;
  critical: boolean;
  sql: string | null;
  cypher: string | null;
  modeUsed: string | null;
  error: string | null;
  graderScore: number;
  graderPassed: boolean;
  graderIssues: string[];
  graderFeedback: string;
  safetyPassed: boolean;
  latencyMs: number;
};

type CategoryStats = {
  passed: number;
  total: number;
  avgScore: number;
};

type EvalSummary = {
  totalTests: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  averageScore: number;
  averageLatency: number;
  criticalPassRate: number;
  byCategory: Record<string, CategoryStats>;
  ciPassed: boolean;
  timestamp: string;
};

type Payload = {
  results: EvalResult[];
  summary: EvalSummary;
};

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 8 ? "bg-emerald-500" : score >= 6 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function CategoryBar({ stats }: { stats: CategoryStats }) {
  const pct = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;
  const color =
    pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 w-24 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        {stats.passed}/{stats.total}
      </span>
    </div>
  );
}

export default function EvalsClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    fetch("/api/evals")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 py-12">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Loading eval results…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-sm text-red-800 dark:text-red-200">
        {error || "No eval data available. Run `npm run eval` to generate results."}
      </div>
    );
  }

  const { results, summary } = data;
  const categories = Object.keys(summary.byCategory);

  const filtered = results.filter((r) => {
    if (filterCategory !== "all" && r.category !== filterCategory) return false;
    if (filterStatus === "passed" && !r.graderPassed) return false;
    if (filterStatus === "failed" && (r.graderPassed || !!r.error)) return false;
    if (filterStatus === "error" && !r.error) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* CI Verdict Banner */}
      <div
        className={`rounded-xl border p-4 text-sm font-medium ${
          summary.ciPassed
            ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200"
            : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
        }`}
      >
        {summary.ciPassed ? "CI CHECK PASSED — Safe to deploy" : "CI CHECK FAILED — Do not deploy"}
        <span className="ml-2 text-xs opacity-60">
          {new Date(summary.timestamp).toLocaleString()}
        </span>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Pass Rate</div>
          <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {(summary.passRate * 100).toFixed(1)}%
          </div>
          <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">threshold: 85%</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Avg Score</div>
          <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {summary.averageScore.toFixed(2)}<span className="text-sm font-normal text-gray-400">/10</span>
          </div>
          <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">threshold: 7.0</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Critical Tests</div>
          <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {(summary.criticalPassRate * 100).toFixed(1)}%
          </div>
          <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">threshold: 90%</div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Avg Latency</div>
          <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {(summary.averageLatency / 1000).toFixed(1)}<span className="text-sm font-normal text-gray-400">s</span>
          </div>
          <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">{summary.totalTests} tests</div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Score by category</h2>
        <div className="space-y-3">
          {categories.map((cat) => {
            const stats = summary.byCategory[cat];
            const pct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
            return (
              <div key={cat} className="flex items-center gap-4">
                <span className="w-28 text-sm font-medium text-gray-700 dark:text-gray-300 capitalize truncate">
                  {cat.replace(/_/g, " ")}
                </span>
                <CategoryBar stats={stats} />
                <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums w-12 text-right">
                  {pct}%
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                  avg {stats.avgScore.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300"
        >
          <option value="all">All statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
          <option value="error">Error</option>
        </select>
        <span className="text-xs text-gray-400 dark:text-gray-500 self-center ml-1">
          {filtered.length} of {results.length} tests
        </span>
      </div>

      {/* Results Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 shadow-sm dark:shadow-none overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-8">#</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Category</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Question</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Score</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Latency</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const expanded = expandedId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                  >
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 tabular-nums">{r.id}</td>
                    <td className="px-4 py-3">
                      {r.error ? (
                        <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-500">Error</span>
                      ) : r.graderPassed ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500">Pass</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-500">Fail</span>
                      )}
                      {r.critical ? (
                        <span className="ml-1 text-[10px] text-red-400" title="Critical test">●</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 capitalize">
                      {r.category.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 truncate max-w-xs">
                      {r.input}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={r.graderScore} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 dark:text-gray-500 tabular-nums">
                      {(r.latencyMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-gray-50 dark:bg-gray-900/50">
                      <td colSpan={6} className="px-6 py-4 space-y-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Question</div>
                          <p className="text-sm text-gray-900 dark:text-gray-100">{r.input}</p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Expected</div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{r.ideal}</p>
                        </div>
                        {r.sql ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Generated SQL</div>
                            <pre className="text-xs bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 overflow-x-auto text-gray-700 dark:text-gray-300">
                              {r.sql}
                            </pre>
                          </div>
                        ) : null}
                        {r.graderFeedback ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">GPT Feedback</div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{r.graderFeedback}</p>
                          </div>
                        ) : null}
                        {r.graderIssues.length > 0 ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Issues</div>
                            <ul className="list-disc pl-4 text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
                              {r.graderIssues.map((issue, i) => <li key={i}>{issue}</li>)}
                            </ul>
                          </div>
                        ) : null}
                        {r.error ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">Error</div>
                            <p className="text-sm text-red-600 dark:text-red-400">{r.error}</p>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


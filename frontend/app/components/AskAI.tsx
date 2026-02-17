"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "@/app/context/ThemeContext";
import DashboardCards from "./DashboardCards";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

type GraphExperiment = {
  id: string;
  experimentId: string;
  testName: string | null;
  changeType: string | null;
  elementChanged: string | null;
  winningVar: string | null;
  vertical: string | null;
  geo: string | null;
  monthlyExtrap: number | null;
  dateConcluded: string | null;
};

type AskResponse = {
  answer?: string;
  // SQL
  sql?: string;
  sqlError?: string;
  notes?: string;
  rows: Record<string, any>[];
  rowCount: number;
  // Graph
  graphRows: Record<string, any>[];
  graphRowCount: number;
  graphError?: string;
  graphExperiments: GraphExperiment[];
  // General
  error?: string;
};

function ThinkingDots() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % 3);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const dots = [" •  ", " • •", " •••"];

  return (
    <span className="inline-flex items-center justify-center min-w-[56px]" aria-live="polite">
      Thinking{dots[step]}
    </span>
  );
}

type GNode = { id: string; label: string; type: string };
type GLink = { source: string; target: string };

function buildGraphData(graphRows: Record<string, any>[], graphExperiments?: GraphExperiment[]) {
  const nodesMap = new Map<string, GNode>();
  const links: GLink[] = [];
  const patternCounts = new Map<string, number>();
  const seenLinks = new Set<string>();

  for (const r of graphRows.slice(0, 30)) {
    const ct = (r.changeType ?? "").toString().trim();
    const el = (r.elementChanged ?? "").toString().trim();
    const cnt = Number(r.experimentCount ?? r.count ?? 1);
    if (!ct || !el) continue;

    const ctKey = `ct:${ct}`;
    const elKey = `el:${el}`;
    if (ct) patternCounts.set(ctKey, (patternCounts.get(ctKey) ?? 0) + cnt);
    if (el) patternCounts.set(elKey, (patternCounts.get(elKey) ?? 0) + cnt);

    if (!nodesMap.has(ctKey)) nodesMap.set(ctKey, { id: ctKey, label: ct, type: "change" });
    if (!nodesMap.has(elKey)) nodesMap.set(elKey, { id: elKey, label: el, type: "element" });
    const linkKey = `${ctKey}->${elKey}`;
    if (!seenLinks.has(linkKey)) {
      seenLinks.add(linkKey);
      links.push({ source: ctKey, target: elKey });
    }
  }

  // Add experiment nodes linked to their change type and element
  if (graphExperiments) {
    for (const exp of graphExperiments.slice(0, 60)) {
      const expKey = `exp:${exp.id ?? exp.experimentId}`;
      const label = exp.testName || exp.experimentId || "Experiment";
      const hasWinner = !!(exp.winningVar && exp.winningVar.trim());
      if (!nodesMap.has(expKey)) {
        nodesMap.set(expKey, { id: expKey, label, type: hasWinner ? "winner" : "experiment" });
      }
      const ct = (exp.changeType ?? "").trim();
      const el = (exp.elementChanged ?? "").trim();
      if (ct) {
        const ctKey = `ct:${ct}`;
        if (!nodesMap.has(ctKey)) nodesMap.set(ctKey, { id: ctKey, label: ct, type: "change" });
        const linkKey = `${expKey}->${ctKey}`;
        if (!seenLinks.has(linkKey)) {
          seenLinks.add(linkKey);
          links.push({ source: expKey, target: ctKey });
        }
      }
      if (el) {
        const elKey = `el:${el}`;
        if (!nodesMap.has(elKey)) nodesMap.set(elKey, { id: elKey, label: el, type: "element" });
        const linkKey = `${expKey}->${elKey}`;
        if (!seenLinks.has(linkKey)) {
          seenLinks.add(linkKey);
          links.push({ source: expKey, target: elKey });
        }
      }
    }
  }

  if (nodesMap.size < 2) return null;
  return { nodes: Array.from(nodesMap.values()), links, patternCounts };
}

function getExperimentsForAttr(
  attrId: string,
  graphExperiments: GraphExperiment[],
): GraphExperiment[] {
  const [prefix, ...rest] = attrId.split(":");
  const value = rest.join(":");
  return graphExperiments.filter((exp) => {
    if (prefix === "ct") return (exp.changeType ?? "").trim() === value;
    if (prefix === "el") return (exp.elementChanged ?? "").trim() === value;
    return false;
  });
}

/* ── Breakdown helpers ── */

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

type TopWinnerExperiment = {
  id?: string;
  experimentId?: string;
  testName?: string;
  winningVar: string;
  extrap: number;
};

function computeBreakdowns(rows: Record<string, any>[]) {
  const verticalMap = new Map<string, number>();
  const geoMap = new Map<string, number>();
  let withWinners = 0;
  let totalExtrap = 0;
  const topExperiments: TopWinnerExperiment[] = [];

  for (const r of rows) {
    const v = ((r.vertical ?? "") as string).trim() || "Unknown";
    verticalMap.set(v, (verticalMap.get(v) ?? 0) + 1);

    const g = ((r.geo ?? "") as string).trim() || "Unknown";
    geoMap.set(g, (geoMap.get(g) ?? 0) + 1);

    const w = ((r.winningVar ?? "") as string).trim();
    if (w) {
      withWinners++;
      const ext = Number(r.monthlyExtrap ?? 0) || 0;
      totalExtrap += ext;
      if (ext > 0) {
        topExperiments.push({
          id: r.id as string | undefined,
          experimentId: r.experimentId as string | undefined,
          testName: r.testName as string | undefined,
          winningVar: w,
          extrap: ext,
        });
      }
    }
  }

  const sortedVerticals = Array.from(verticalMap.entries()).sort((a, b) => b[1] - a[1]);
  const sortedGeos = Array.from(geoMap.entries()).sort((a, b) => b[1] - a[1]);
  // Top 5 individual experiments by monthly extrap
  const topWinners = topExperiments.sort((a, b) => b.extrap - a.extrap).slice(0, 5);

  const uniqueVerticals = sortedVerticals.filter(([k]) => k !== "Unknown").length;
  const uniqueGeos = sortedGeos.filter(([k]) => k !== "Unknown").length;

  return {
    total: rows.length,
    withWinners,
    uniqueVerticals,
    uniqueGeos,
    totalExtrap,
    verticals: sortedVerticals,
    geos: sortedGeos,
    topWinners,
  };
}

/* ── Markdown custom components for prose rendering ── */

const mdComponents: Components = {
  // H2 → subtle section dividers (Executive Summary, Key Highlights, etc.)
  h2: ({ children }) => (
    <div className="not-prose mt-0 mb-3 border-t border-gray-100 dark:border-gray-700 first:border-t-0">
      <span className="inline-block mt-4 mb-1 px-1 text-[10px] font-extrabold tracking-widest uppercase text-slate-400 dark:text-slate-500">
        {children}
      </span>
    </div>
  ),

  // H3 → learning/theme cards with left accent
  h3: ({ children }) => (
    <h3 className="not-prose mt-4 mb-2 rounded-md bg-slate-50 dark:bg-slate-800/50 border-l-[3px] border-blue-500 px-3 py-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
      {children}
    </h3>
  ),

  // Strong at the start of a paragraph → muted label style
  strong: ({ children }) => (
    <strong className="font-bold text-slate-900 dark:text-slate-200">{children}</strong>
  ),

  // Tables (from remark-gfm) → nice bordered table
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-slate-50 dark:bg-gray-700 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">{children}</td>
  ),

  // Blockquotes → call-out style
  blockquote: ({ children }) => (
    <blockquote className="not-prose my-3 rounded-r-md border-l-[3px] border-blue-300 bg-blue-50/50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-900 dark:text-blue-200 italic">
      {children}
    </blockquote>
  ),
};

/* ── Main component ── */

type KpiCard = {
  title: string;
  subtitle: string;
  value: string;
  change: number;
  changeLabel?: string;
  sparkline: number[];
};

type AskAIProps = {
  defaultRows?: Record<string, any>[];
  defaultLabel?: string;
  kpiCards?: KpiCard[];
  kpiLabels?: string[];
};

export default function AskAI({ defaultRows, defaultLabel, kpiCards, kpiLabels }: AskAIProps = {}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [expandedAttrs, setExpandedAttrs] = useState<Set<string>>(new Set());

  // Responsive graph width — observe container size changes
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(600);
  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setGraphWidth(w);
      }
    });
    ro.observe(el);
    // initial measure
    if (el.clientWidth > 0) setGraphWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [result]);

  // Theme-aware graph background
  const { currentTheme } = useTheme();
  const graphBg = currentTheme === "dark" ? "#1f2937" : "#ffffff";

  // Breakdowns: prefer SQL rows if they have individual experiment data,
  // fall back to graphExperiments (always individual rows), then default rows.
  const breakdowns = useMemo(() => {
    if (result) {
      // Check if SQL rows have individual experiment data (not aggregated)
      const sqlRows = result.rows ?? [];
      const hasExperimentData = sqlRows.length > 0 && sqlRows[0]?.vertical !== undefined;
      if (hasExperimentData) return computeBreakdowns(sqlRows);
      // Fallback: use graphExperiments which always have individual rows
      if (result.graphExperiments?.length) return computeBreakdowns(result.graphExperiments);
      // Last resort: use SQL rows anyway
      if (sqlRows.length) return computeBreakdowns(sqlRows);
    }
    if (defaultRows?.length) return computeBreakdowns(defaultRows);
    return null;
  }, [result, defaultRows]);

  // Which rows to use for the experiments table — prefer SQL if individual, else graphExperiments
  const activeRows = useMemo(() => {
    if (result) {
      const sqlRows = result.rows ?? [];
      if (sqlRows.length > 0 && sqlRows[0]?.experimentId) return sqlRows;
      if (result.graphExperiments?.length) return result.graphExperiments;
      return sqlRows;
    }
    return defaultRows ?? [];
  }, [result, defaultRows]);
  const activeLabel = result ? "Query results" : defaultLabel ?? "Previous month";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!question.trim()) {
      setError("Please enter a question.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Request failed");
      } else {
        const resultData = {
          answer: json.answer,
          sql: json.sql,
          sqlError: json.sqlError,
          notes: json.notes,
          rows: json.rows ?? [],
          rowCount: json.rowCount ?? 0,
          graphRows: json.graphRows ?? [],
          graphRowCount: json.graphRowCount ?? 0,
          graphError: json.graphError,
          graphExperiments: json.graphExperiments ?? [],
        };
        console.log(`[AskAI] ─── Results for: "${question}" ───`);
        console.log(`[AskAI] SQL: ${resultData.sqlError ? "FAILED" : `${resultData.rowCount} rows`}`);
        console.log(`[AskAI] Graph patterns: ${resultData.graphError ? "FAILED" : `${resultData.graphRowCount} patterns`}`);
        console.log(`[AskAI] Graph experiments (for panel): ${resultData.graphExperiments.length}`);
        setResult(resultData);
        setTablePage(1);
        setExpandedAttrs(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  /* ── Experiments table ── */
  const renderExperimentsTable = () => {
    if (!activeRows.length) return null;
    const rows = activeRows;
    // Only show if rows have experimentId (individual experiment rows, not aggregates)
    if (!rows[0]?.experimentId) return null;

    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(tablePage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const fmtDate = (v: any) => {
      if (!v) return "—";
      const s = String(v);
      return s.length >= 10 ? s.slice(0, 10) : s;
    };

    return (
      <div className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Experiments — {activeLabel} ({rows.length})
          </h2>
          {totalPages > 1 ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-200 dark:border-gray-700/60 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-gray-200 dark:border-gray-700/60 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700/60 text-left text-gray-600 dark:text-gray-400">
                <th className="px-3 py-2 font-medium">Experiment</th>
                <th className="px-3 py-2 font-medium">Test name</th>
                <th className="px-3 py-2 font-medium">Vertical</th>
                <th className="px-3 py-2 font-medium">Geo</th>
                <th className="px-3 py-2 font-medium">Concluded</th>
                <th className="px-3 py-2 font-medium">Winner</th>
                <th className="px-3 py-2 font-medium">Monthly extrap</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => {
                const uuid = row.id as string | undefined;
                return (
                  <tr
                    key={uuid ?? `row-${start + idx}`}
                    className="border-b border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                      {uuid ? (
                        <button
                          type="button"
                          onClick={() => setModalId(uuid)}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {row.experimentId ?? "—"}
                        </button>
                      ) : (
                        (row.experimentId as string) ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[240px]">
                      {row.testName ?? "—"}
                    </td>
                    <td className="px-3 py-2">{row.vertical ?? "—"}</td>
                    <td className="px-3 py-2">{row.geo ?? "—"}</td>
                    <td className="px-3 py-2">{fmtDate(row.dateConcluded)}</td>
                    <td className="px-3 py-2">
                      {((row.winningVar ?? "") as string).trim() || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {typeof row.monthlyExtrap === "number"
                        ? formatMoney(row.monthlyExtrap)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
              {!pageRows.length ? (
                <tr>
                  <td className="px-3 py-3 text-gray-500 dark:text-gray-400" colSpan={7}>
                    No experiment rows found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-0">
      {/* ── Ask form ── */}
      <div className="relative rounded-2xl border-2 border-violet-400 dark:border-violet-500 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none animate-[pulse-border_3s_ease-in-out_infinite]">
        {/* Pulsing glow ring */}
        <div className="pointer-events-none absolute -inset-px rounded-2xl border-2 border-violet-400/60 dark:border-violet-500/40 animate-ping [animation-duration:3s] opacity-30" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-violet-700 dark:text-violet-400 sm:text-2xl">
              Ask the data
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Ask anything about experiments; we&apos;ll query the database and summarise.
            </p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., What did we test on Merchant Accounts UK in the past 6 months?"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 shadow-inner focus:border-blue-500 focus:outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400"
            rows={3}
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? <ThinkingDots /> : "Ask"}
          </button>
        </form>
        {error ? (
          <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : null}
      </div>

      {/* ── Empty state (only when no default data and no result) ── */}
      {!result && !loading && !error && !defaultRows?.length ? (
        <div className="mt-8 flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl text-gray-300 dark:text-gray-600">?</div>
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 max-w-md">
            Ask a question above to explore experiment data. The results will appear here with
            breakdowns by vertical, geo, winners, and a full experiment table.
          </p>
        </div>
      ) : null}

      {/* ── Default data header ── */}
      {!result && defaultRows?.length ? (
        <div className="mt-6 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-800 dark:text-blue-200">
          Showing <span className="font-semibold">{defaultLabel}</span> recap ({defaultRows.length} experiments).
          Ask a question above to explore specific data.
        </div>
      ) : null}

      {/* ── KPI cards (hide when AI response is showing) ── */}
      {!result && kpiCards && kpiCards.length > 0 ? (
        <div className="mt-6">
          <DashboardCards cards={kpiCards} labels={kpiLabels ?? []} />
        </div>
      ) : null}

      {/* ── AI answer ── */}
      {result?.answer ? (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 px-5 py-5 shadow-sm dark:shadow-none prose prose-sm prose-slate dark:prose-invert max-w-none
          prose-headings:text-slate-800 dark:prose-headings:text-slate-200
          prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-3 prose-h4:mb-1
          prose-p:text-slate-600 dark:prose-p:text-slate-300 prose-p:leading-relaxed prose-p:my-1.5
          prose-li:text-slate-600 dark:prose-li:text-slate-300 prose-li:my-0.5
          prose-strong:text-slate-900 dark:prose-strong:text-slate-100 prose-strong:block
          prose-em:text-slate-500 dark:prose-em:text-slate-400
          prose-code:text-slate-700 dark:prose-code:text-slate-300 prose-code:bg-slate-100 dark:prose-code:bg-slate-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
          prose-hr:my-3 prose-hr:border-gray-100 dark:prose-hr:border-gray-700
          prose-ul:my-2 prose-ol:my-2
          prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {result.answer}
          </ReactMarkdown>
        </div>
      ) : null}

      {/* ── Analysis stats bar ── */}
      {result ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/60 px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-300">Analysis scope:</span>
          <span>{result.rowCount} SQL rows</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span>{result.graphRowCount} graph patterns</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span>{result.graphExperiments.length} experiments for graph</span>
          {result.sqlError ? (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-red-500 dark:text-red-400">SQL error</span>
            </>
          ) : null}
          {result.graphError ? (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-red-500 dark:text-red-400">Graph error</span>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Summary cards ── */}
      {breakdowns ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Experiments analysed</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">{breakdowns.total}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">matching your query</div>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400">With winners</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">{breakdowns.withWinners}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {breakdowns.total > 0
                ? `${Math.round((breakdowns.withWinners / breakdowns.total) * 100)}% win rate`
                : "—"}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400">Verticals</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {breakdowns.uniqueVerticals}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">unique verticals</div>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {breakdowns.totalExtrap > 0 ? "Winner Revenue" : "Geos"}
            </div>
            <div className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {breakdowns.totalExtrap > 0
                ? formatMoney(breakdowns.totalExtrap)
                : breakdowns.uniqueGeos}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {breakdowns.totalExtrap > 0 ? "monthly extrap from winning tests" : "unique geos"}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Breakdowns (vertical, geo, winners) ── */}
      {breakdowns ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Vertical */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Vertical breakdown</h3>
            <div className="mt-3 grid gap-1.5 text-sm">
              {breakdowns.verticals.slice(0, 10).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-1.5 last:border-b-0"
                >
                  <span className="text-gray-700 dark:text-gray-300">{k}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{v}</span>
                </div>
              ))}
              {!breakdowns.verticals.length ? (
                <div className="text-gray-500 dark:text-gray-400 text-xs">No vertical data.</div>
              ) : null}
            </div>
          </div>

          {/* Geo */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Geo breakdown</h3>
            <div className="mt-3 grid gap-1.5 text-sm">
              {breakdowns.geos.slice(0, 10).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-1.5 last:border-b-0"
                >
                  <span className="text-gray-700 dark:text-gray-300">{k}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{v}</span>
                </div>
              ))}
              {!breakdowns.geos.length ? (
                <div className="text-gray-500 dark:text-gray-400 text-xs">No geo data.</div>
              ) : null}
            </div>
          </div>

          {/* Top winner experiments */}
          <div className="sm:col-span-2 lg:col-span-1 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Top winner experiments</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">By monthly extrapolated revenue</p>
            <div className="mt-3 grid gap-2 text-sm">
              {breakdowns.topWinners.map((w, idx) => (
                <div
                  key={w.id ?? w.experimentId ?? idx}
                  className="flex items-start justify-between gap-3 border-b border-gray-100 dark:border-gray-700 pb-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {w.id ? (
                        <button
                          type="button"
                          onClick={() => setModalId(w.id!)}
                          className="text-left text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {w.testName || w.experimentId || "Experiment"}
                        </button>
                      ) : (
                        w.testName || w.experimentId || "Experiment"
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      Winner Var: <span className="font-medium text-emerald-600 dark:text-emerald-400">{w.winningVar}</span>
                    </div>
                  </div>
                  <div className="shrink-0 font-semibold text-gray-900 dark:text-gray-100 text-right tabular-nums">
                    {formatMoney(w.extrap)}
                  </div>
                </div>
              ))}
              {!breakdowns.topWinners.length ? (
                <div className="text-gray-500 dark:text-gray-400 text-xs">No winner experiments found.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Graph + experiments table + source data ── */}
      {result ? (() => {
        const graphData = buildGraphData(result.graphRows, result.graphExperiments);
        const selectedExps = expandedAttrs.size > 0
          ? Array.from(expandedAttrs).flatMap((attr) => getExperimentsForAttr(attr, result.graphExperiments))
          : [];
        const seen = new Set<string>();
        const uniqueExps = selectedExps.filter((e) => {
          const k = e.id ?? e.experimentId;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        return (
          <>
            {/* Graph pattern visualization */}
            {graphData ? (
              <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-4 shadow-sm dark:shadow-none space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Experiment graph</div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Click a <span className="font-semibold text-blue-600">change type</span> or{" "}
                    <span className="font-semibold text-emerald-600">element</span> node to see
                    related experiments below.
                  </p>
                </div>
                <div ref={graphContainerRef} className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <ForceGraph3D
                    graphData={{ nodes: graphData.nodes, links: graphData.links }}
                    width={graphWidth}
                    height={420}
                    backgroundColor={graphBg}
                    nodeColor={(node: any) => {
                      if (node.type === "change")
                        return expandedAttrs.has(node.id) ? "#1d4ed8" : "#3b82f6";
                      if (node.type === "element")
                        return expandedAttrs.has(node.id) ? "#059669" : "#10b981";
                      if (node.type === "winner") return "#f59e0b";
                      if (node.type === "experiment") return "#6b7280";
                      return "#6b7280";
                    }}
                    nodeVal={(n: any) => {
                      if (n.type === "experiment" || n.type === "winner") return 2;
                      const cnt = graphData.patternCounts.get(n.id) ?? 1;
                      return Math.max(4, Math.min(14, cnt * 0.8));
                    }}
                    nodeLabel={(n: any) => {
                      if (n.type === "experiment" || n.type === "winner") return n.label;
                      const cnt = graphData.patternCounts.get(n.id) ?? 0;
                      return `${n.label} (${cnt} experiments)`;
                    }}
                    linkWidth={1.5}
                    linkDirectionalParticles={1}
                    linkDirectionalParticleSpeed={0.005}
                    warmupTicks={30}
                    cooldownTicks={100}
                  />
                </div>

                {/* Graph legend */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />Change type</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Element</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />Winner experiment</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-500" />Experiment</span>
                </div>

                {/* Clickable attribute chips — replaces unreliable 3D node clicks */}
                {(() => {
                  const changeNodes = graphData.nodes.filter((n) => n.type === "change");
                  const elementNodes = graphData.nodes.filter((n) => n.type === "element");
                  const toggleAttr = (id: string) => {
                    setExpandedAttrs((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  };
                  return (
                    <div className="space-y-2">
                      {changeNodes.length > 0 ? (
                        <div>
                          <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Change types</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">
                            Select a label to see related experiments — e.g. tap <span className="font-medium text-blue-500">&ldquo;New component&rdquo;</span> to list all new-component tests.
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {changeNodes.map((n) => {
                              const cnt = graphData.patternCounts.get(n.id) ?? 0;
                              const selected = expandedAttrs.has(n.id);
                              return (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => toggleAttr(n.id)}
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                    selected
                                      ? "bg-blue-600 text-white shadow-sm"
                                      : "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                                  }`}
                                >
                                  {n.label}
                                  <span className={`text-[10px] ${selected ? "text-blue-200" : "text-blue-400 dark:text-blue-400"}`}>
                                    {cnt}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {elementNodes.length > 0 ? (
                        <div>
                          <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">Elements</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">
                            Select an element to filter — e.g. tap <span className="font-medium text-emerald-500">&ldquo;Hero&rdquo;</span> to see all hero-related experiments.
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {elementNodes.map((n) => {
                              const cnt = graphData.patternCounts.get(n.id) ?? 0;
                              const selected = expandedAttrs.has(n.id);
                              return (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => toggleAttr(n.id)}
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                    selected
                                      ? "bg-emerald-600 text-white shadow-sm"
                                      : "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                                  }`}
                                >
                                  {n.label}
                                  <span className={`text-[10px] ${selected ? "text-emerald-200" : "text-emerald-400 dark:text-emerald-400"}`}>
                                    {cnt}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {expandedAttrs.size > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpandedAttrs(new Set())}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          Clear all selections
                        </button>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Experiments panel — appears below the graph when a node is selected */}
                {uniqueExps.length > 0 ? (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {uniqueExps.length} related experiment
                      {uniqueExps.length !== 1 ? "s" : ""}
                    </div>
                    <div className="max-h-[280px] overflow-y-auto space-y-1.5">
                      {uniqueExps.map((exp) => (
                        <button
                          key={exp.id ?? exp.experimentId}
                          type="button"
                          className="w-full text-left rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
                          onClick={() => exp.id && setModalId(exp.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {exp.testName ?? exp.experimentId}
                              </div>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {exp.changeType ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                                    {exp.changeType}
                                  </span>
                                ) : null}
                                {exp.elementChanged ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                    {exp.elementChanged}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {exp.winningVar ? (
                              <span className="shrink-0 inline-flex items-center rounded-full bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                                Winner: {exp.winningVar}
                              </span>
                            ) : (
                              <span className="shrink-0 inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">
                                No winner
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : expandedAttrs.size > 0 ? (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                      No experiments found for this selection.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Collapsible source data */}
            <details className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-3 shadow-sm dark:shadow-none">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
                Show source data
              </summary>
              <div className="mt-3 space-y-4">
                {result.sql ? (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-900/50 p-3 shadow-sm dark:shadow-none space-y-3">
                    <div className="flex items-center justify-between text-sm font-semibold text-gray-900 dark:text-gray-100">
                      <span>SQL query</span>
                      {result.sqlError ? (
                        <span className="text-xs text-red-600 dark:text-red-400">{result.sqlError}</span>
                      ) : null}
                    </div>
                    {result.notes ? (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Notes:{" "}
                        <span className="font-medium text-gray-800 dark:text-gray-200">{result.notes}</span>
                      </div>
                    ) : null}
                    <pre className="whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      {result.sql}
                    </pre>
                  </div>
                ) : null}
              </div>
            </details>
          </>
        );
      })() : null}

      {/* ── Experiments table (works for both query results and default rows) ── */}
      {renderExperimentsTable()}

      {/* ── Experiment detail modal ── */}
      {modalId ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setModalId(null)}
        >
          <div
            className="relative h-[80vh] w-[90vw] max-w-5xl overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-2xl ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setModalId(null)}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 shadow-md transition-all hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 hover:scale-110"
              aria-label="Close"
            >
              <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
            <iframe
              src={`/experiments/${modalId}?bare=1`}
              className="h-full w-full border-0"
              title="Experiment detail"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

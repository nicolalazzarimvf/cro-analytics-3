"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

type GraphExperiment = {
  id: string;
  experimentId: string;
  testName: string | null;
  changeType: string | null;
  elementChanged: string | null;
  winningVar: string | null;
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

function buildGraphData(graphRows: Record<string, any>[]) {
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

function computeBreakdowns(rows: Record<string, any>[]) {
  const verticalMap = new Map<string, number>();
  const geoMap = new Map<string, number>();
  const winnerMap = new Map<string, { count: number; extrap: number }>();
  let withWinners = 0;
  let totalExtrap = 0;

  for (const r of rows) {
    const v = ((r.vertical ?? "") as string).trim() || "Unknown";
    verticalMap.set(v, (verticalMap.get(v) ?? 0) + 1);

    const g = ((r.geo ?? "") as string).trim() || "Unknown";
    geoMap.set(g, (geoMap.get(g) ?? 0) + 1);

    const w = ((r.winningVar ?? "") as string).trim();
    if (w) {
      withWinners++;
      const prev = winnerMap.get(w) ?? { count: 0, extrap: 0 };
      const ext = Number(r.monthlyExtrap ?? 0) || 0;
      winnerMap.set(w, { count: prev.count + 1, extrap: prev.extrap + ext });
      totalExtrap += ext;
    }
  }

  const sortedVerticals = Array.from(verticalMap.entries()).sort((a, b) => b[1] - a[1]);
  const sortedGeos = Array.from(geoMap.entries()).sort((a, b) => b[1] - a[1]);
  const sortedWinners = Array.from(winnerMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.extrap - a.extrap || b.count - a.count);

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
    winners: sortedWinners,
  };
}

/* ── Main component ── */

type AskAIProps = {
  defaultRows?: Record<string, any>[];
  defaultLabel?: string;
};

export default function AskAI({ defaultRows, defaultLabel }: AskAIProps = {}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [expandedAttrs, setExpandedAttrs] = useState<Set<string>>(new Set());

  // Breakdowns: from query result, or from server-provided default rows
  const breakdowns = useMemo(() => {
    if (result?.rows?.length) return computeBreakdowns(result.rows);
    if (defaultRows?.length) return computeBreakdowns(defaultRows);
    return null;
  }, [result, defaultRows]);

  // Which rows to use for the experiments table (query result or default)
  const activeRows = result?.rows?.length ? result.rows : defaultRows ?? [];
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
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-gray-900">
            Experiments — {activeLabel} ({rows.length})
          </h2>
          {totalPages > 1 ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-600">
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
                    className="border-b border-gray-100 text-gray-700"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {uuid ? (
                        <button
                          type="button"
                          onClick={() => setModalId(uuid)}
                          className="text-blue-700 hover:underline"
                        >
                          {row.experimentId ?? "—"}
                        </button>
                      ) : (
                        (row.experimentId as string) ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[240px] truncate">
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
                  <td className="px-3 py-3 text-gray-500" colSpan={7}>
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
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Ask the data</h2>
            <p className="text-sm text-gray-600">
              Ask anything about experiments; we&apos;ll query the database and summarise.
            </p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., What did we test on Merchant Accounts UK in the past 6 months?"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-inner focus:border-blue-500 focus:outline-none"
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
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
      </div>

      {/* ── Empty state (only when no default data and no result) ── */}
      {!result && !loading && !error && !defaultRows?.length ? (
        <div className="mt-8 flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl text-gray-300">?</div>
          <p className="mt-3 text-sm text-gray-500 max-w-md">
            Ask a question above to explore experiment data. The results will appear here with
            breakdowns by vertical, geo, winners, and a full experiment table.
          </p>
        </div>
      ) : null}

      {/* ── Default data header ── */}
      {!result && defaultRows?.length ? (
        <div className="mt-6 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          Showing <span className="font-semibold">{defaultLabel}</span> recap ({defaultRows.length} experiments).
          Ask a question above to explore specific data.
        </div>
      ) : null}

      {/* ── AI answer ── */}
      {result?.answer ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm ai-response">
          <style jsx global>{`
            /* ── Reset ── */
            .ai-response {
              padding: 0;
              overflow: hidden;
            }

            /* ── H2 section headers — full-width accent bars ── */
            .ai-response h2 {
              margin: 0;
              padding: 0.625rem 1.25rem;
              font-size: 0.6875rem;
              font-weight: 800;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: #465fff;
              background: linear-gradient(to right, #f0f4ff, #f8fafc);
              border-top: 1px solid #e5e7eb;
            }
            .ai-response h2:first-child {
              border-top: none;
              border-radius: 0.75rem 0.75rem 0 0;
            }

            /* ── Content after H2 — padded sections ── */
            .ai-response h2 + * { margin-top: 0; }
            .ai-response h2 ~ p,
            .ai-response h2 ~ ul,
            .ai-response h2 ~ ol,
            .ai-response h2 ~ blockquote {
              margin-left: 1.25rem;
              margin-right: 1.25rem;
            }

            /* ── H3 sub-sections — card style ── */
            .ai-response h3 {
              margin: 1rem 1.25rem 0;
              padding: 0.5rem 0.75rem;
              font-size: 0.8125rem;
              font-weight: 700;
              color: #1e293b;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 0.5rem 0.5rem 0 0;
              border-bottom: 2px solid #465fff;
            }

            /* Content immediately after H3 — indented card body */
            .ai-response h3 + p,
            .ai-response h3 + ul,
            .ai-response h3 + ol {
              margin: 0 1.25rem 0.75rem;
              padding: 0.75rem;
              background: #fafbfc;
              border: 1px solid #e2e8f0;
              border-top: none;
              border-radius: 0 0 0.5rem 0.5rem;
            }
            /* Subsequent siblings of h3 (2nd p, 2nd ul after h3) */
            .ai-response h3 ~ p,
            .ai-response h3 ~ ul,
            .ai-response h3 ~ ol {
              margin-left: 1.25rem;
              margin-right: 1.25rem;
              padding-left: 0.75rem;
              padding-right: 0.75rem;
            }

            /* ── H4 ── */
            .ai-response h4 {
              margin: 0.5rem 1.25rem 0.25rem;
              font-size: 0.8125rem;
              font-weight: 600;
              color: #334155;
            }

            /* ── Paragraphs ── */
            .ai-response p {
              margin-bottom: 0.5rem;
              font-size: 0.8125rem;
              color: #374151;
              line-height: 1.75;
            }
            .ai-response > p:first-of-type {
              padding: 1rem 1.25rem 0;
            }

            /* ── Strong labels — "What we tested:", "What worked:" etc ── */
            .ai-response strong {
              font-weight: 700;
              color: #0f172a;
            }
            .ai-response p > strong:first-child {
              display: block;
              margin-top: 0.5rem;
              margin-bottom: 0.25rem;
              padding: 0.25rem 0;
              font-size: 0.6875rem;
              font-weight: 800;
              letter-spacing: 0.06em;
              text-transform: uppercase;
              color: #465fff;
              border-bottom: 1px solid #e5e7eb;
            }

            /* ── Unordered lists ── */
            .ai-response ul {
              margin-top: 0.25rem;
              margin-bottom: 0.75rem;
              padding-left: 0;
              list-style: none;
            }
            .ai-response ul li {
              position: relative;
              padding-left: 1.125rem;
              font-size: 0.8125rem;
              color: #374151;
              line-height: 1.7;
              margin-bottom: 0.25rem;
            }
            .ai-response ul li::before {
              content: "";
              position: absolute;
              left: 0.125rem;
              top: 0.55em;
              width: 5px;
              height: 5px;
              border-radius: 50%;
              background: #465fff;
            }

            /* ── Ordered lists ── */
            .ai-response ol {
              margin-top: 0.25rem;
              margin-bottom: 0.75rem;
              padding-left: 0;
              list-style: none;
              counter-reset: ol-counter;
            }
            .ai-response ol li {
              position: relative;
              padding-left: 2rem;
              font-size: 0.8125rem;
              color: #374151;
              line-height: 1.7;
              margin-bottom: 0.5rem;
              counter-increment: ol-counter;
            }
            .ai-response ol li::before {
              content: counter(ol-counter);
              position: absolute;
              left: 0;
              top: 0.1em;
              width: 1.375rem;
              height: 1.375rem;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 0.6875rem;
              font-weight: 800;
              color: white;
              background: #465fff;
              border-radius: 50%;
            }

            /* ── Emphasis ── */
            .ai-response em {
              font-style: italic;
              color: #64748b;
            }

            /* ── Inline code ── */
            .ai-response code {
              background: #f1f5f9;
              padding: 0.125rem 0.375rem;
              border-radius: 0.25rem;
              font-size: 0.75rem;
              font-family: ui-monospace, monospace;
              color: #465fff;
            }

            /* ── Blockquotes ── */
            .ai-response blockquote {
              border-left: 3px solid #465fff;
              background: #eff6ff;
              padding: 0.75rem 1rem;
              margin: 0.5rem 1.25rem;
              border-radius: 0 0.5rem 0.5rem 0;
            }
            .ai-response blockquote p {
              margin: 0;
              padding: 0;
              font-size: 0.8125rem;
              font-style: italic;
              color: #1e40af;
              line-height: 1.6;
            }

            /* ── Horizontal rules ── */
            .ai-response hr {
              margin: 0;
              border: none;
              border-top: 1px solid #e5e7eb;
            }

            /* ── Bottom padding ── */
            .ai-response > *:last-child {
              padding-bottom: 1.25rem;
            }
          `}</style>
          <ReactMarkdown>{result.answer}</ReactMarkdown>
        </div>
      ) : null}

      {/* ── Analysis stats bar ── */}
      {result ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">Analysis scope:</span>
          <span>{result.rowCount} SQL rows</span>
          <span className="text-gray-300">|</span>
          <span>{result.graphRowCount} graph patterns</span>
          <span className="text-gray-300">|</span>
          <span>{result.graphExperiments.length} experiments for graph</span>
          {result.sqlError ? (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-red-500">SQL error</span>
            </>
          ) : null}
          {result.graphError ? (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-red-500">Graph error</span>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Summary cards ── */}
      {breakdowns ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Experiments analysed</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{breakdowns.total}</div>
            <div className="mt-1 text-xs text-gray-500">matching your query</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-gray-600">With winners</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{breakdowns.withWinners}</div>
            <div className="mt-1 text-xs text-gray-500">
              {breakdowns.total > 0
                ? `${Math.round((breakdowns.withWinners / breakdowns.total) * 100)}% win rate`
                : "—"}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Verticals</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {breakdowns.uniqueVerticals}
            </div>
            <div className="mt-1 text-xs text-gray-500">unique verticals</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-gray-600">
              {breakdowns.totalExtrap > 0 ? "Total monthly extrap" : "Geos"}
            </div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {breakdowns.totalExtrap > 0
                ? formatMoney(breakdowns.totalExtrap)
                : breakdowns.uniqueGeos}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {breakdowns.totalExtrap > 0 ? "sum across winners" : "unique geos"}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Breakdowns (vertical, geo, winners) ── */}
      {breakdowns ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Vertical */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Vertical breakdown</h3>
            <div className="mt-3 grid gap-1.5 text-sm">
              {breakdowns.verticals.slice(0, 10).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 pb-1.5 last:border-b-0"
                >
                  <span className="text-gray-700">{k}</span>
                  <span className="font-medium text-gray-900">{v}</span>
                </div>
              ))}
              {!breakdowns.verticals.length ? (
                <div className="text-gray-500 text-xs">No vertical data.</div>
              ) : null}
            </div>
          </div>

          {/* Geo */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Geo breakdown</h3>
            <div className="mt-3 grid gap-1.5 text-sm">
              {breakdowns.geos.slice(0, 10).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 pb-1.5 last:border-b-0"
                >
                  <span className="text-gray-700">{k}</span>
                  <span className="font-medium text-gray-900">{v}</span>
                </div>
              ))}
              {!breakdowns.geos.length ? (
                <div className="text-gray-500 text-xs">No geo data.</div>
              ) : null}
            </div>
          </div>

          {/* Winners */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Top winners</h3>
            <div className="mt-3 grid gap-2 text-sm">
              {breakdowns.winners.slice(0, 8).map((w) => (
                <div
                  key={w.name}
                  className="flex items-start justify-between gap-4 border-b border-gray-100 pb-1.5 last:border-b-0"
                >
                  <div>
                    <div className="font-medium text-gray-900">{w.name}</div>
                    <div className="text-xs text-gray-500">{w.count} experiment{w.count !== 1 ? "s" : ""}</div>
                  </div>
                  {w.extrap > 0 ? (
                    <div className="font-semibold text-gray-900 text-right">
                      {formatMoney(w.extrap)}
                    </div>
                  ) : null}
                </div>
              ))}
              {!breakdowns.winners.length ? (
                <div className="text-gray-500 text-xs">No winners found.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Graph + experiments table + source data ── */}
      {result ? (() => {
        const graphData = buildGraphData(result.graphRows);
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
              <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Experiment graph</div>
                  <p className="text-xs text-gray-500">
                    Click a <span className="font-semibold text-blue-600">change type</span> or{" "}
                    <span className="font-semibold text-emerald-600">element</span> node to see
                    related experiments below.
                  </p>
                </div>
                <div className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-100 bg-white">
                  <ForceGraph3D
                    graphData={{ nodes: graphData.nodes, links: graphData.links }}
                    width={800}
                    height={400}
                    backgroundColor="#ffffff"
                    nodeColor={(node: any) => {
                      if (node.type === "change")
                        return expandedAttrs.has(node.id) ? "#1d4ed8" : "#3b82f6";
                      if (node.type === "element")
                        return expandedAttrs.has(node.id) ? "#059669" : "#10b981";
                      return "#6b7280";
                    }}
                    nodeLabel={(n: any) => {
                      const cnt = graphData.patternCounts.get(n.id) ?? 0;
                      return `${n.label} (${cnt} experiments)`;
                    }}
                    nodeVal={(n: any) => {
                      const cnt = graphData.patternCounts.get(n.id) ?? 1;
                      return Math.max(4, Math.min(14, cnt * 0.8));
                    }}
                    linkWidth={1.5}
                    linkDirectionalParticles={1}
                    linkDirectionalParticleSpeed={0.005}
                    warmupTicks={30}
                    cooldownTicks={100}
                  />
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
                          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Change types</div>
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
                                      : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                                  }`}
                                >
                                  {n.label}
                                  <span className={`text-[10px] ${selected ? "text-blue-200" : "text-blue-400"}`}>
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
                          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Elements</div>
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
                                      : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                                  }`}
                                >
                                  {n.label}
                                  <span className={`text-[10px] ${selected ? "text-emerald-200" : "text-emerald-400"}`}>
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
                          className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                        >
                          Clear all selections
                        </button>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Experiments panel — appears below the graph when a node is selected */}
                {uniqueExps.length > 0 ? (
                  <div className="border-t border-gray-200 pt-3 space-y-2">
                    <div className="text-xs font-semibold text-gray-700">
                      {uniqueExps.length} related experiment
                      {uniqueExps.length !== 1 ? "s" : ""}
                    </div>
                    <div className="max-h-[280px] overflow-y-auto space-y-1.5">
                      {uniqueExps.map((exp) => (
                        <button
                          key={exp.id ?? exp.experimentId}
                          type="button"
                          className="w-full text-left rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                          onClick={() => exp.id && setModalId(exp.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {exp.testName ?? exp.experimentId}
                              </div>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {exp.changeType ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                    {exp.changeType}
                                  </span>
                                ) : null}
                                {exp.elementChanged ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                    {exp.elementChanged}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {exp.winningVar ? (
                              <span className="shrink-0 inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700 border border-green-200">
                                Winner: {exp.winningVar}
                              </span>
                            ) : (
                              <span className="shrink-0 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 border border-gray-200">
                                No winner
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : expandedAttrs.size > 0 ? (
                  <div className="border-t border-gray-200 pt-3">
                    <p className="text-xs text-gray-400 italic">
                      No experiments found for this selection.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Collapsible source data */}
            <details className="mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900">
                Show source data
              </summary>
              <div className="mt-3 space-y-4">
                {result.sql ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm space-y-3">
                    <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                      <span>SQL query</span>
                      {result.sqlError ? (
                        <span className="text-xs text-red-600">{result.sqlError}</span>
                      ) : null}
                    </div>
                    {result.notes ? (
                      <div className="text-xs text-gray-600">
                        Notes:{" "}
                        <span className="font-medium text-gray-800">{result.notes}</span>
                      </div>
                    ) : null}
                    <pre className="whitespace-pre-wrap text-xs text-gray-700 bg-white rounded-lg border border-gray-200 p-3">
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="relative h-[80vh] w-[90vw] max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setModalId(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-white/80 px-2 py-1 text-sm font-semibold text-gray-700 shadow hover:bg-white"
            >
              x
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

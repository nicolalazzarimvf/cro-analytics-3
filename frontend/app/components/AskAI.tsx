"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

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

/**
 * Build a single combined 3D graph showing experiments connected to their
 * changeType and elementChanged attributes. Experiments that share the same
 * attribute naturally cluster together.
 */
function buildCombinedGraphData(
  sqlRows: Record<string, any>[],
  graphRows: Record<string, any>[],
) {
  type GNode = { id: string; label: string; type: string; uuid?: string; title?: string };
  const nodesMap = new Map<string, GNode>();
  const links: Array<{ source: string; target: string }> = [];

  // Build a set of pattern counts for sizing attribute nodes
  const patternCounts = new Map<string, number>();
  for (const r of graphRows) {
    const ct = (r.changeType ?? "").toString().trim();
    const el = (r.elementChanged ?? "").toString().trim();
    const cnt = Number(r.experimentCount ?? r.count ?? 1);
    if (ct) patternCounts.set(`ct:${ct}`, (patternCounts.get(`ct:${ct}`) ?? 0) + cnt);
    if (el) patternCounts.set(`el:${el}`, (patternCounts.get(`el:${el}`) ?? 0) + cnt);
  }

  // Add experiment rows as nodes (limit to 30 for performance)
  const experiments = sqlRows
    .filter((r) => r && r.experimentId)
    .slice(0, 30);

  for (const exp of experiments) {
    const expId = (exp.experimentId ?? "").toString().trim();
    if (!expId || nodesMap.has(expId)) continue;

    nodesMap.set(expId, {
      id: expId,
      label: expId,
      type: "experiment",
      uuid: exp.id?.toString(),
      title: exp.testName?.toString() ?? undefined,
    });

    // Link experiment to its changeType
    const ct = (exp.changeType ?? "").toString().trim();
    if (ct) {
      const ctKey = `ct:${ct}`;
      if (!nodesMap.has(ctKey)) {
        nodesMap.set(ctKey, { id: ctKey, label: ct, type: "change" });
      }
      links.push({ source: expId, target: ctKey });
    }

    // Link experiment to its elementChanged
    const el = (exp.elementChanged ?? "").toString().trim();
    if (el) {
      const elKey = `el:${el}`;
      if (!nodesMap.has(elKey)) {
        nodesMap.set(elKey, { id: elKey, label: el, type: "element" });
      }
      links.push({ source: expId, target: elKey });
    }
  }

  // If SQL rows don't have changeType/elementChanged, fall back to graph-only pattern nodes
  if (links.length === 0 && graphRows.length > 0) {
    for (const r of graphRows.slice(0, 20)) {
      const ct = (r.changeType ?? "").toString().trim();
      const el = (r.elementChanged ?? "").toString().trim();
      if (!ct || !el) continue;
      const ctKey = `ct:${ct}`;
      const elKey = `el:${el}`;
      if (!nodesMap.has(ctKey)) nodesMap.set(ctKey, { id: ctKey, label: ct, type: "change" });
      if (!nodesMap.has(elKey)) nodesMap.set(elKey, { id: elKey, label: el, type: "element" });
      links.push({ source: ctKey, target: elKey });
    }
  }

  if (nodesMap.size < 2) return null;

  return {
    nodes: Array.from(nodesMap.values()),
    links,
    patternCounts,
  };
}

export default function AskAI() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);

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
        body: JSON.stringify({ question })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Request failed");
      } else {
        setResult({
          answer: json.answer,
          sql: json.sql,
          sqlError: json.sqlError,
          notes: json.notes,
          rows: json.rows ?? [],
          rowCount: json.rowCount ?? 0,
          graphRows: json.graphRows ?? [],
          graphRowCount: json.graphRowCount ?? 0,
          graphError: json.graphError,
        });
        setTablePage(1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const renderTable = (res: { rows: Record<string, any>[]; rowCount: number }) => {
    if (!res?.rows?.length) return null;
    // If rows contain a graph payload (identity/labels/properties), flatten to properties for display.
    const normalizedRows = res.rows.map((row) => {
      if (row && typeof row === "object" && "properties" in row && row.properties && typeof row.properties === "object") {
        return row.properties as Record<string, unknown>;
      }
      return row;
    });
    const cols = Object.keys(normalizedRows[0] ?? {}).filter((c) => c !== "id"); // hide uuid column
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(normalizedRows.length / pageSize));
    const currentPage = Math.min(tablePage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageRows = normalizedRows.slice(start, end);

    const formatVal = (val: any) => {
      if (val === null || val === undefined) return "—";
      if (Array.isArray(val)) {
        if (!val.length) return "[]";
        return val
          .map((item) => (item && typeof item === "object" ? JSON.stringify(item) : String(item)))
          .join(", ");
      }
      if (val instanceof Date) return val.toISOString();
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    };

    const excerpt = (text: string, max = 120) => {
      if (text.length <= max) return text;
      return text.slice(0, max) + "…";
    };

    const summaryRows = normalizedRows.filter((r) => r && typeof r === "object" && "experimentId" in r);

    // If we have experiment summaries, show only the recap table (avoid duplicate detail table).
    if (summaryRows.length) {
      return (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-xs font-semibold text-gray-700">Summary</div>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-700">
                    <th className="px-2 py-1 font-medium">Experiment</th>
                    <th className="px-2 py-1 font-medium">Title</th>
                    <th className="px-2 py-1 font-medium">Winner</th>
                    <th className="px-2 py-1 font-medium">Concluded</th>
                    <th className="px-2 py-1 font-medium">Optimizely</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.slice(0, 10).map((row, idx) => {
                    const expId = row.experimentId as string | undefined;
                    const uuid = (row as any).id as string | undefined;
                    const optimizely = (row as any).optimizelyLink as string | undefined;
                    return (
                      <tr key={`summary-${idx}`} className="border-b border-gray-100 text-gray-700">
                        <td className="px-2 py-1">
                          {expId ? (
                            <button
                              type="button"
                              onClick={() => uuid && setModalId(uuid)}
                              className="text-brand-700 hover:underline"
                              disabled={!uuid}
                            >
                              {expId}
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1">{row.testName ? formatVal(row.testName) : "—"}</td>
                        <td className="px-2 py-1">{row.winningVar ? formatVal(row.winningVar) : "—"}</td>
                        <td className="px-2 py-1">
                          {row.dateConcluded ? formatVal(row.dateConcluded).slice(0, 10) : "—"}
                        </td>
                        <td className="px-2 py-1">
                          {optimizely ? (
                            <a href={optimizely} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                              Open
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-700">
              {cols.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <tr key={start + idx} className="border-b border-gray-100 text-gray-700">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-2">
                    {(() => {
                      const val = row[c];
                      if (val === null || val === undefined) return "—";
                      // Link to experiment detail using the UUID id when present (preferred), else fall back to experimentId.
                      if (c === "experimentId") {
                        const targetId = row.id || null;
                        const href = targetId ? `/experiments/${targetId}` : undefined;
                        return href ? (
                          <button
                            type="button"
                            onClick={() => setModalId(targetId)}
                            className="text-brand-700 hover:underline"
                          >
                            {formatVal(val)}
                          </button>
                        ) : (
                          formatVal(val)
                        );
                      }
                      // Shorten long text fields for readability
                      if (c === "hypothesis" || c === "lessonLearned") {
                        return excerpt(formatVal(val));
                      }
                      return formatVal(val);
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-gray-50 px-4 py-2 text-xs text-gray-600">
          Showing {normalizedRows.length} of {res.rowCount} rows
        </div>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-600">
              <span>
            Page {currentPage} of {totalPages} — showing {pageRows.length} of {normalizedRows.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
              disabled={currentPage <= 1}
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50"
                >
                  ← Prev
                </button>
                <button
                  type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Ask the data</h2>
          <p className="text-sm text-gray-600">
            Ask anything about experiments; we'll query the database and summarise.
          </p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g., What did we test on Merchant Accounts UK in the past 6 months?"
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-inner focus:border-brand-500 focus:outline-none"
          rows={3}
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? <ThinkingDots /> : "Ask"}
        </button>
      </form>
      {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {result?.answer ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm ai-response">
          <style jsx global>{`
            .ai-response h2 {
              margin-top: 1.5rem;
              margin-bottom: 0.75rem;
              font-size: 1.125rem;
              font-weight: 700;
              color: #111827;
              border-bottom: 1px solid #f3f4f6;
              padding-bottom: 0.5rem;
            }
            .ai-response h2:first-child { margin-top: 0; }
            .ai-response h3 {
              margin-top: 1rem;
              margin-bottom: 0.5rem;
              font-size: 1rem;
              font-weight: 600;
              color: #1f2937;
            }
            .ai-response h4 {
              margin-top: 0.75rem;
              margin-bottom: 0.25rem;
              font-size: 0.875rem;
              font-weight: 600;
              color: #374151;
            }
            .ai-response p {
              margin-bottom: 0.5rem;
              font-size: 0.875rem;
              color: #374151;
              line-height: 1.625;
            }
            .ai-response ul {
              margin-bottom: 0.75rem;
              padding-left: 0;
              list-style: none;
            }
            .ai-response ul li {
              display: flex;
              align-items: flex-start;
              gap: 0.5rem;
              font-size: 0.875rem;
              color: #374151;
              margin-bottom: 0.375rem;
            }
            .ai-response ul li::before {
              content: "•";
              color: #465fff;
              font-weight: 600;
              flex-shrink: 0;
              margin-top: 0.125rem;
            }
            .ai-response ol {
              margin-bottom: 0.75rem;
              padding-left: 0;
              list-style: none;
              counter-reset: ol-counter;
            }
            .ai-response ol li {
              display: flex;
              align-items: flex-start;
              gap: 0.5rem;
              font-size: 0.875rem;
              color: #374151;
              margin-bottom: 0.375rem;
              counter-increment: ol-counter;
            }
            .ai-response ol li::before {
              content: counter(ol-counter) ".";
              color: #465fff;
              font-weight: 600;
              flex-shrink: 0;
              min-width: 1.25rem;
            }
            .ai-response strong {
              font-weight: 600;
              color: #111827;
            }
            .ai-response em {
              font-style: italic;
              color: #6b7280;
            }
            .ai-response code {
              background: #f3f4f6;
              padding: 0.125rem 0.375rem;
              border-radius: 0.25rem;
              font-size: 0.75rem;
              font-family: monospace;
            }
            .ai-response blockquote {
              border-left: 4px solid #93c5fd;
              background: #eff6ff;
              padding: 0.5rem 1rem;
              margin: 0.75rem 0;
              font-style: italic;
              color: #374151;
            }
            .ai-response hr {
              margin: 1rem 0;
              border: none;
              border-top: 1px solid #e5e7eb;
            }
          `}</style>
          <ReactMarkdown>{result.answer}</ReactMarkdown>
        </div>
      ) : null}
      {result ? (() => {
        const graphData = buildCombinedGraphData(result.rows, result.graphRows);
        return (
          <>
            {/* Combined graph — shown directly below the answer */}
            {graphData ? (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Experiment graph</div>
                  <p className="text-xs text-gray-500">
                    Experiments linked to their change type and element. Click an experiment to view details.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5">
                    <span className="block h-2.5 w-2.5 rounded-full bg-orange-500" /> Experiment
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5">
                    <span className="block h-2.5 w-2.5 rounded-full bg-blue-500" /> Change type
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5">
                    <span className="block h-2.5 w-2.5 rounded-full bg-emerald-500" /> Element
                  </span>
                </div>
                <div className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-100 bg-white">
                  <ForceGraph3D
                    graphData={{ nodes: graphData.nodes, links: graphData.links }}
                    width={800}
                    height={400}
                    backgroundColor="#ffffff"
                    nodeColor={(node: any) => {
                      switch (node.type) {
                        case "experiment": return "#f97316";
                        case "change": return "#3b82f6";
                        case "element": return "#10b981";
                        default: return "#6b7280";
                      }
                    }}
                    nodeLabel={(n: any) => {
                      if (n.type === "experiment") return `${n.label}${n.title ? ` — ${n.title}` : ""}`;
                      return n.label;
                    }}
                    nodeVal={(n: any) => {
                      if (n.type === "experiment") return 3;
                      // Size attribute nodes by how many experiments use them
                      const key = n.id;
                      const cnt = graphData.patternCounts.get(key) ?? 1;
                      return Math.max(4, Math.min(14, cnt * 0.8));
                    }}
                    linkWidth={1.5}
                    linkDirectionalParticles={1}
                    linkDirectionalParticleSpeed={0.005}
                    warmupTicks={30}
                    cooldownTicks={100}
                    onNodeClick={(node: any) => {
                      if (node.type === "experiment" && node.uuid) {
                        setModalId(node.uuid);
                      }
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* Collapsible source data */}
            <details className="mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900">Show source data</summary>
              <div className="mt-3 space-y-4">
                {/* SQL */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm space-y-3">
                  <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                    <span>SQL result ({result.rowCount} rows)</span>
                    {result.sqlError ? <span className="text-xs text-red-600">{result.sqlError}</span> : null}
                  </div>
                  {result.notes ? (
                    <div className="text-xs text-gray-600">
                      Notes: <span className="font-medium text-gray-800">{result.notes}</span>
                    </div>
                  ) : null}
                  {result.sql ? (
                    <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
                      <summary className="cursor-pointer text-sm font-semibold text-gray-900">SQL used</summary>
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700">{result.sql}</pre>
                    </details>
                  ) : null}
                  {result.rows.length > 0 ? (
                    <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
                      <summary className="cursor-pointer text-sm font-semibold text-gray-900">Data table</summary>
                      {renderTable({ rows: result.rows, rowCount: result.rowCount })}
                    </details>
                  ) : null}
                </div>

                {/* Graph patterns */}
                {result.graphRows.length > 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm space-y-3">
                    <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                      <span>Graph patterns ({result.graphRowCount} patterns)</span>
                      {result.graphError ? <span className="text-xs text-red-600">{result.graphError}</span> : null}
                    </div>
                    <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
                      <summary className="cursor-pointer text-sm font-semibold text-gray-900">Pattern data</summary>
                      {renderTable({ rows: result.graphRows, rowCount: result.graphRowCount })}
                    </details>
                  </div>
                ) : null}
              </div>
            </details>
          </>
        );
      })() : null}

      {modalId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="relative h-[80vh] w-[90vw] max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setModalId(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-white/80 px-2 py-1 text-sm font-semibold text-gray-700 shadow hover:bg-white"
            >
              ×
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

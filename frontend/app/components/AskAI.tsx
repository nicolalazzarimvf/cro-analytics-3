"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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

/**
 * Build a static graph of changeType ↔ elementChanged patterns.
 * No experiment nodes — those are shown in a panel below the graph.
 */
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

/** Get experiments matching a selected attribute node */
function getExperimentsForAttr(
  attrId: string,
  graphExperiments: GraphExperiment[],
): GraphExperiment[] {
  // attrId is like "ct:CTA" or "el:Button"
  const [prefix, ...rest] = attrId.split(":");
  const value = rest.join(":"); // handle values with colons
  return graphExperiments.filter((exp) => {
    if (prefix === "ct") return (exp.changeType ?? "").trim() === value;
    if (prefix === "el") return (exp.elementChanged ?? "").trim() === value;
    return false;
  });
}

export default function AskAI() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [expandedAttrs, setExpandedAttrs] = useState<Set<string>>(new Set());

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
        console.log(`[AskAI] SQL: ${resultData.sqlError ? `FAILED` : `${resultData.rowCount} rows`}`);
        console.log(`[AskAI] Graph patterns: ${resultData.graphError ? `FAILED` : `${resultData.graphRowCount} patterns`}`);
        console.log(`[AskAI] Graph experiments (for panel): ${resultData.graphExperiments.length}`);
        console.log(`[AskAI] Full result:`, resultData);
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
        <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm ai-response">
          <style jsx global>{`
            /* ── Container ── */
            .ai-response { padding: 0; }

            /* ── H2 sections ── */
            .ai-response h2 {
              margin: 0;
              padding: 0.75rem 1.25rem;
              font-size: 0.8125rem;
              font-weight: 700;
              letter-spacing: 0.04em;
              text-transform: uppercase;
              color: #465fff;
              background: #f8fafc;
              border-top: 1px solid #e5e7eb;
            }
            .ai-response h2:first-child {
              border-top: none;
              border-radius: 0.75rem 0.75rem 0 0;
            }

            /* ── Section body (content between h2s) ── */
            .ai-response h2 + * { margin-top: 0; }
            .ai-response h2 ~ p,
            .ai-response h2 ~ ul,
            .ai-response h2 ~ ol,
            .ai-response h2 ~ blockquote {
              padding-left: 1.25rem;
              padding-right: 1.25rem;
            }

            /* ── H3 sub-sections (learning cards) ── */
            .ai-response h3 {
              margin: 0.75rem 1.25rem 0.5rem;
              padding: 0.625rem 0.875rem;
              font-size: 0.875rem;
              font-weight: 600;
              color: #1f2937;
              background: #f9fafb;
              border: 1px solid #e5e7eb;
              border-radius: 0.5rem;
            }
            .ai-response h3 + p,
            .ai-response h3 + ul {
              margin-left: 1.25rem;
              margin-right: 1.25rem;
              padding-left: 0.875rem;
              padding-right: 0.875rem;
              border-left: 2px solid #e5e7eb;
            }

            /* ── H4 ── */
            .ai-response h4 {
              margin: 0.625rem 1.25rem 0.25rem;
              font-size: 0.8125rem;
              font-weight: 600;
              color: #374151;
            }

            /* ── Paragraphs ── */
            .ai-response p {
              margin-bottom: 0.625rem;
              padding-top: 0.375rem;
              font-size: 0.875rem;
              color: #374151;
              line-height: 1.7;
            }
            .ai-response > p:first-of-type {
              padding: 1rem 1.25rem 0;
            }

            /* ── Strong labels (What we tested:, Key quote:, etc.) ── */
            .ai-response strong {
              font-weight: 600;
              color: #111827;
            }
            .ai-response p > strong:first-child {
              display: inline-block;
              margin-bottom: 0.125rem;
              font-size: 0.75rem;
              font-weight: 700;
              letter-spacing: 0.02em;
              text-transform: uppercase;
              color: #6b7280;
            }

            /* ── Unordered lists ── */
            .ai-response ul {
              margin-top: 0.25rem;
              margin-bottom: 0.75rem;
              padding-left: 1.25rem;
              padding-right: 1.25rem;
              list-style: none;
            }
            .ai-response ul li {
              position: relative;
              padding-left: 1rem;
              font-size: 0.875rem;
              color: #374151;
              line-height: 1.65;
              margin-bottom: 0.375rem;
            }
            .ai-response ul li::before {
              content: "";
              position: absolute;
              left: 0;
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
              padding-left: 1.25rem;
              padding-right: 1.25rem;
              list-style: none;
              counter-reset: ol-counter;
            }
            .ai-response ol li {
              position: relative;
              padding-left: 1.75rem;
              font-size: 0.875rem;
              color: #374151;
              line-height: 1.65;
              margin-bottom: 0.5rem;
              counter-increment: ol-counter;
            }
            .ai-response ol li::before {
              content: counter(ol-counter);
              position: absolute;
              left: 0;
              top: 0.05em;
              width: 1.25rem;
              height: 1.25rem;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 0.6875rem;
              font-weight: 700;
              color: white;
              background: #465fff;
              border-radius: 50%;
            }

            /* ── Emphasis ── */
            .ai-response em {
              font-style: italic;
              color: #6b7280;
            }

            /* ── Inline code ── */
            .ai-response code {
              background: #f3f4f6;
              padding: 0.125rem 0.375rem;
              border-radius: 0.25rem;
              font-size: 0.75rem;
              font-family: monospace;
              color: #465fff;
            }

            /* ── Blockquotes ── */
            .ai-response blockquote {
              border-left: 3px solid #465fff;
              background: #eff6ff;
              padding: 0.75rem 1rem;
              margin: 0.75rem 1.25rem;
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
              padding-bottom: 1rem;
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
      {result ? (() => {
        const graphData = buildGraphData(result.graphRows);
        const selectedExps = expandedAttrs.size > 0
          ? Array.from(expandedAttrs).flatMap((attr) => getExperimentsForAttr(attr, result.graphExperiments))
          : [];
        // deduplicate by experiment id
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
              <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Experiment graph</div>
                  <p className="text-xs text-gray-500">
                    Click a <span className="font-semibold text-blue-600">change type</span> or <span className="font-semibold text-emerald-600">element</span> node to see related experiments below.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5">
                    <span className="block h-2.5 w-2.5 rounded-full bg-blue-500" /> Change type
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5">
                    <span className="block h-2.5 w-2.5 rounded-full bg-emerald-500" /> Element
                  </span>
                  {expandedAttrs.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedAttrs(new Set())}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-200"
                    >
                      Clear selection
                    </button>
                  ) : null}
                </div>
                <div className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-100 bg-white">
                  <ForceGraph3D
                    graphData={{ nodes: graphData.nodes, links: graphData.links }}
                    width={800}
                    height={400}
                    backgroundColor="#ffffff"
                    nodeColor={(node: any) => {
                      if (node.type === "change") return expandedAttrs.has(node.id) ? "#1d4ed8" : "#3b82f6";
                      if (node.type === "element") return expandedAttrs.has(node.id) ? "#059669" : "#10b981";
                      return "#6b7280";
                    }}
                    nodeLabel={(n: any) => {
                      const cnt = graphData.patternCounts.get(n.id) ?? 0;
                      const selected = expandedAttrs.has(n.id);
                      return `${n.label} (${cnt} experiments)${selected ? " ✓" : ""}`;
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
                    onNodeClick={(node: any) => {
                      console.log(`[Graph] Node clicked:`, { id: node.id, type: node.type, label: node.label });
                      if (node.type === "change" || node.type === "element") {
                        const matchingExps = getExperimentsForAttr(node.id, result.graphExperiments);
                        console.log(`[Graph] Matching experiments for "${node.id}":`, matchingExps.length);
                        if (matchingExps.length === 0) {
                          console.warn(`[Graph] No experiments found! Available graphExperiments:`, result.graphExperiments.length);
                          console.warn(`[Graph] Sample graphExperiments:`, result.graphExperiments.slice(0, 5));
                        }
                        setExpandedAttrs((prev) => {
                          const next = new Set(prev);
                          if (next.has(node.id)) {
                            next.delete(node.id);
                            console.log(`[Graph] Collapsed "${node.id}". Active selections:`, Array.from(next));
                          } else {
                            next.add(node.id);
                            console.log(`[Graph] Expanded "${node.id}". Active selections:`, Array.from(next));
                          }
                          return next;
                        });
                      } else {
                        console.log(`[Graph] Node type "${node.type}" is not expandable`);
                      }
                    }}
                  />
                </div>

                {/* Experiments panel — appears below the graph when a node is selected */}
                {uniqueExps.length > 0 ? (
                  <div className="border-t border-gray-200 pt-3 space-y-2">
                    <div className="text-xs font-semibold text-gray-700">
                      {uniqueExps.length} related experiment{uniqueExps.length !== 1 ? "s" : ""}
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
                    <p className="text-xs text-gray-400 italic">No experiments found for this selection.</p>
                  </div>
                ) : null}
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

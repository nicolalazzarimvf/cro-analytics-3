"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

type Mode = "auto" | "sql" | "graph";

type AskResult = {
  kind?: "sql" | "graph";
  modeUsed: "sql" | "graph";
  answer?: string;
  sql?: string;
  cypher?: string;
  notes?: string;
  rows: Record<string, any>[];
  rowCount: number;
  truncated?: boolean;
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

function pickCount(row: Record<string, any>) {
  return (
    row.experimentCount ??
    row.count ??
    row.wins ??
    row.total ??
    row.num ??
    row.rowCount ??
    row.frequency ??
    "n"
  );
}

function summarizeGraph(res: AskResult) {
  if (res.error) return `Graph error: ${res.error}`;
  if (!res.rows?.length) return "Graph ran, but no patterns returned.";
  const pairs = res.rows.slice(0, 5).map((r) => {
    const ct = r.changeType ?? "Unknown change type";
    const el = r.elementChanged ?? "Unknown element";
    const cnt = pickCount(r);
    return `- ${ct} → ${el} (${cnt})`;
  });
  return `Graph patterns (top ${pairs.length}):\n${pairs.join("\n")}`;
}

function buildCombined(sqlRes: AskResult | null, graphRes: AskResult | null) {
  const sqlPart = sqlRes?.error
    ? `SQL error: ${sqlRes.error}`
    : sqlRes?.answer
      ? `SQL summary:\n${sqlRes.answer}`
      : "SQL result below.";

  if (!graphRes) return sqlPart;

  const graphPart = summarizeGraph(graphRes);
  return `${sqlPart}\n\n${graphPart}`;
}

function renderGraphChart(res: AskResult) {
  if (res.kind !== "graph") return null;
  const rows = filteredGraphRows(res);
  if (!rows.length) return null;
  const items = rows
    .slice(0, 10)
    .map((r) => ({
      label: `${r.changeType ?? "Unknown change"} → ${r.elementChanged ?? "Unknown element"}`,
      value: Number(pickCount(r)) || 0
    }))
    .filter((d) => d.value > 0);
  if (!items.length) return null;
  const max = Math.max(...items.map((d) => d.value));
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-700">Graph patterns (top 10)</div>
      <div className="space-y-1">
        {items.map((item, idx) => (
          <div key={idx} className="text-xs text-gray-800">
            <div className="flex items-center gap-2">
              <div className="flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  className="h-3 rounded bg-brand-500"
                  style={{ width: `${Math.max(5, (item.value / max) * 100)}%` }}
                  aria-label={`${item.label} ${item.value}`}
                />
              </div>
              <span className="w-10 text-right font-semibold text-gray-700">{item.value}</span>
            </div>
            <div className="truncate text-[11px] text-gray-600">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderGraphNetwork(res: AskResult) {
  if (res.kind !== "graph") return null;
  const rows = filteredGraphRows(res);
  if (!rows.length) return null;
  const edges = rows
    .slice(0, 12)
    .map((r) => ({
      source: r.changeType ?? "Unknown change",
      target: r.elementChanged ?? "Unknown element",
      value: Number(pickCount(r)) || 1
    }))
    .filter((e) => e.source && e.target);
  if (!edges.length) return null;

  const leftNodes = Array.from(new Set(edges.map((e) => e.source)));
  const rightNodes = Array.from(new Set(edges.map((e) => e.target)));
  const maxVal = Math.max(...edges.map((e) => e.value));

  const width = 560;
  const height = 260;
  const margin = 16;

  const leftY = (i: number) =>
    margin + (i + 1) * ((height - 2 * margin) / (leftNodes.length + 1));
  const rightY = (i: number) =>
    margin + (i + 1) * ((height - 2 * margin) / (rightNodes.length + 1));

  const leftX = margin + 80;
  const rightX = width - margin - 80;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-700">Graph view (top links)</div>
      <div className="overflow-x-auto">
        <svg width={width} height={height} className="bg-white">
          {/* edges */}
          {edges.map((e, idx) => {
            const sIdx = leftNodes.indexOf(e.source);
            const tIdx = rightNodes.indexOf(e.target);
            const y1 = leftY(sIdx);
            const y2 = rightY(tIdx);
            const strokeWidth = Math.max(1.5, (e.value / maxVal) * 6);
            return (
              <g key={idx} opacity={0.8}>
                <line
                  x1={leftX}
                  y1={y1}
                  x2={rightX}
                  y2={y2}
                  stroke="#2563eb"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  opacity={0.6}
                />
                <text
                  x={(leftX + rightX) / 2}
                  y={(y1 + y2) / 2 - 4}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#4b5563"
                >
                  {e.value}
                </text>
              </g>
            );
          })}
          {/* left nodes */}
          {leftNodes.map((n, i) => (
            <g key={`l-${n}`}>
              <circle cx={leftX} cy={leftY(i)} r={8} fill="#1d4ed8" opacity={0.9} />
              <text x={leftX - 12} y={leftY(i) + 4} textAnchor="end" fontSize="11" fill="#1f2937">
                {n}
              </text>
            </g>
          ))}
          {/* right nodes */}
          {rightNodes.map((n, i) => (
            <g key={`r-${n}`}>
              <circle cx={rightX} cy={rightY(i)} r={8} fill="#10b981" opacity={0.9} />
              <text x={rightX + 12} y={rightY(i) + 4} textAnchor="start" fontSize="11" fill="#1f2937">
                {n}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function filteredGraphRows(res: AskResult) {
  if (res.kind !== "graph" || !res.rows?.length) return [];
  return res.rows.filter((r) => {
    const ct = (r?.changeType ?? "").toString().toLowerCase();
    const el = (r?.elementChanged ?? "").toString().toLowerCase();
    const isUnknownCt = !ct || ct.includes("unknown");
    const isUnknownEl = !el || el.includes("unknown");
    const isOtherCt = ct === "other";
    const isOtherEl = el === "other";
    return !((isUnknownCt || isOtherCt) && (isUnknownEl || isOtherEl));
  });
}

function renderGraph3D(res: AskResult) {
  if (res.kind !== "graph") return null;
  const rows = filteredGraphRows(res).slice(0, 20);
  if (!rows.length) return null;

  const nodesMap = new Map<string, { id: string; label: string; type: string }>();
  const links: Array<{ source: string; target: string; value: number }> = [];

  rows.forEach((r) => {
    const ct = r.changeType ?? "Unknown change";
    const el = r.elementChanged ?? "Unknown element";
    const val = Number(pickCount(r)) || 1;
    if (!nodesMap.has(ct)) nodesMap.set(ct, { id: ct, label: ct, type: "change" });
    if (!nodesMap.has(el)) nodesMap.set(el, { id: el, label: el, type: "element" });
    links.push({ source: ct, target: el, value: val });
  });

  const data = {
    nodes: Array.from(nodesMap.values()),
    links
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-gray-700">3D graph (top links)</div>
      <div className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ForceGraph3D
          graphData={data}
          width={600}
          height={400}
          nodeAutoColorBy="type"
          nodeLabel={(n: any) => n.label}
          nodeVal={(n: any) => (n.type === "change" ? 6 : 4)}
          linkWidth={(l: any) => Math.max(1.5, (l.value / Math.max(...links.map((x) => x.value))) * 5)}
          linkDirectionalParticles={1}
          linkDirectionalParticleSpeed={0.004}
        />
      </div>
    </div>
  );
}

export default function AskAI() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [combinedAnswer, setCombinedAnswer] = useState<string | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);

  const fetchSql = async () => {
    const res = await fetch("/api/ai/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    const json = await res.json();
    if (!res.ok) {
      return { kind: "sql" as const, error: json.error || "SQL request failed", rows: [], rowCount: 0 };
    }
    return {
      kind: "sql" as const,
      ...json,
      rows: json.rows || [],
      rowCount: json.rowCount ?? (json.rows ? json.rows.length : 0),
      truncated: json.truncated ?? false
    };
  };

  const fetchGraph = async () => {
    const res = await fetch("/api/ai/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    const json = await res.json();
    if (!res.ok) {
      return { kind: "graph" as const, error: json.error || "Graph request failed", rows: [], rowCount: 0 };
    }
    return {
      kind: "graph" as const,
      cypher: json.cypher,
      rows: json.rows || [],
      rowCount: json.rowCount ?? (json.rows ? json.rows.length : 0),
      truncated: json.truncated ?? false,
      answer: `Graph result for: ${question}`
    };
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCombinedAnswer(null);
    if (!question.trim()) {
      setError("Please enter a question.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Request failed");
      } else {
        const modeUsed = json.modeUsed as "sql" | "graph";
        const rowCount = json.rowCount ?? (json.rows ? json.rows.length : 0);
        const normalized: AskResult = {
          modeUsed,
          answer: json.answer,
          sql: json.sql,
          cypher: json.cypher,
          notes: json.notes,
          rows: json.rows ?? [],
          rowCount,
          truncated: json.truncated ?? false
        };
        setResult(normalized);
        setCombinedAnswer(json.answer ?? null);
        setTablePage(1); // reset pagination on new result
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const renderTable = (res: AskResult) => {
    if (!res?.rows?.length) return null;
    const cols = Object.keys(res.rows[0] ?? {}).filter((c) => c !== "id"); // hide uuid column
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(res.rows.length / pageSize));
    const currentPage = Math.min(tablePage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageRows = res.rows.slice(start, end);

    const excerpt = (text: string, max = 120) => {
      if (text.length <= max) return text;
      return text.slice(0, max) + "…";
    };

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
                            {String(val)}
                          </button>
                        ) : (
                          String(val)
                        );
                      }
                      // Shorten long text fields for readability
                      if (c === "hypothesis" || c === "lessonLearned") {
                        return excerpt(String(val));
                      }
                      return String(val);
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-gray-50 px-4 py-2 text-xs text-gray-600">
          Showing {res.rows.length} of {res.rowCount} rows {res.truncated ? "(truncated)" : ""}
        </div>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-600">
              <span>
            Page {currentPage} of {totalPages} — showing {pageRows.length} of {res.rows.length}
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
            Ask anything about experiments; we’ll query the DB (and graph when relevant) and summarise.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm text-gray-700">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="mode"
            value="auto"
            checked={mode === "auto"}
            onChange={() => setMode("auto")}
            className="h-4 w-4 accent-brand-600"
          />
          Auto (SQL + Graph when needed)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="mode"
            value="sql"
            checked={mode === "sql"}
            onChange={() => setMode("sql")}
            className="h-4 w-4 accent-brand-600"
          />
          SQL (Postgres only)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="mode"
            value="graph"
            checked={mode === "graph"}
            onChange={() => setMode("graph")}
            className="h-4 w-4 accent-brand-600"
          />
          Graph (Neo4j only)
        </label>
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
      {combinedAnswer ? (
        <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 px-3 py-3 text-sm text-gray-900 whitespace-pre-wrap">
          {combinedAnswer}
        </div>
      ) : null}
      {result ? (
        <details className="mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">Show source results (SQL / Graph)</summary>
          <div className="mt-3 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm space-y-3">
                <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                  <span>{result.modeUsed === "sql" ? "SQL result" : "Graph result"}</span>
                </div>
              {result.notes ? (
                <div className="text-xs text-gray-600">
                  Notes: <span className="font-medium text-gray-800">{result.notes}</span>
                </div>
              ) : null}
              {result.modeUsed === "sql" && result.sql ? (
                <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-900">SQL used</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700">{result.sql}</pre>
                </details>
              ) : null}
              {result.modeUsed === "graph" && result.cypher ? (
                <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-900">Cypher used</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700">{result.cypher}</pre>
                </details>
              ) : null}
                  {result.modeUsed === "graph" ? (
                    <div className="space-y-3">
                      {renderGraphChart(result)}
                      {renderGraphNetwork(result)}
                      {renderGraph3D(result)}
                    </div>
                  ) : null}
              <details className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
                <summary className="cursor-pointer text-sm font-semibold text-gray-900">Data used</summary>
                {renderTable(result)}
              </details>
            </div>
          </div>
        </details>
      ) : null}

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

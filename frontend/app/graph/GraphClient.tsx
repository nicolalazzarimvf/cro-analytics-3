"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/app/context/ThemeContext";
import { useRouter } from "next/navigation";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

type GNode = {
  id: string;
  label: string;
  type: string;
  count: number;
  href?: string;
  title?: string;
  winner?: boolean;
};

type GLink = { source: string; target: string; value: number };

type GraphPayload = {
  nodes: GNode[];
  links: GLink[];
  experimentCount: number;
};

const NODE_TYPES = [
  { key: "experiment", label: "Experiments", color: "#6b7280" },
  { key: "change", label: "Change Type", color: "#3b82f6" },
  { key: "element", label: "Element", color: "#10b981" },
  { key: "vertical", label: "Vertical", color: "#a855f7" },
  { key: "geo", label: "Geo", color: "#f59e0b" },
  { key: "brand", label: "Brand", color: "#ec4899" },
];

export default function GraphClient() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(
    new Set(NODE_TYPES.map((t) => t.key)),
  );

  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const { currentTheme } = useTheme();
  const graphBg = currentTheme === "dark" ? "#111827" : "#f9fafb";
  const router = useRouter();

  // Measure container
  const measure = useCallback(() => {
    if (containerRef.current) {
      setDims({
        w: containerRef.current.clientWidth,
        h: containerRef.current.clientHeight,
      });
    }
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Fetch graph data
  useEffect(() => {
    setLoading(true);
    fetch("/api/graph/full")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Filter graph by visible types
  const filtered = data
    ? {
        nodes: data.nodes.filter((n) => visibleTypes.has(n.type)),
        links: data.links.filter((l) => {
          const sId = typeof l.source === "string" ? l.source : (l.source as any).id;
          const tId = typeof l.target === "string" ? l.target : (l.target as any).id;
          const sNode = data.nodes.find((n) => n.id === sId);
          const tNode = data.nodes.find((n) => n.id === tId);
          return sNode && tNode && visibleTypes.has(sNode.type) && visibleTypes.has(tNode.type);
        }),
      }
    : null;

  const toggleType = (key: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow removing all types
        if (next.size <= 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Counts per type
  const typeCounts = data
    ? NODE_TYPES.map((t) => ({
        ...t,
        count: data.nodes.filter((n) => n.type === t.key).length,
      }))
    : NODE_TYPES.map((t) => ({ ...t, count: 0 }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          Knowledge Graph
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-gray-500 dark:text-gray-400">
          Interactive 3D visualisation of all experiments and their relationships.
          Each experiment is connected to its attributes — change type, element, vertical, geo, and brand.
          Clusters reveal common testing patterns across the programme.
        </p>
        {data ? (
          <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
            {data.experimentCount} experiments · {data.nodes.length} nodes · {data.links.length} connections
          </p>
        ) : null}
      </div>

      {/* Graph */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-[500px] rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-900 overflow-hidden shadow-sm dark:shadow-none"
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-500">
            <svg className="animate-spin h-6 w-6 mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading graph data…
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm">
            Failed to load graph: {error}
          </div>
        ) : filtered ? (
          <ForceGraph3D
            ref={graphRef}
            graphData={filtered}
            width={dims.w}
            height={dims.h}
            backgroundColor={graphBg}
            controlType="orbit"
            enableNavigationControls
            showNavInfo={false}
            onEngineStop={() => {
              if (graphRef.current) {
                try { graphRef.current.zoomToFit(800, 60); } catch {}
              }
            }}
            nodeColor={(node: any) => {
              if (node.type === "experiment" && node.winner) return "#f97316";
              const found = NODE_TYPES.find((t) => t.key === node.type);
              return found?.color ?? "#6b7280";
            }}
            nodeVal={(n: any) => {
              if (n.type === "experiment") return 2;
              return Math.max(3, Math.min(16, (n.count ?? 1) * 0.6));
            }}
            nodeLabel={(n: any) => {
              const parts = [n.label];
              if (n.title) parts.push(n.title);
              if (n.type !== "experiment") parts.push(`(${n.count} experiments)`);
              if (n.winner) parts.push("★ Winner");
              return parts.join(" — ");
            }}
            onNodeClick={(node: any) => {
              if (node.href) router.push(node.href);
            }}
            linkWidth={0.4}
            linkOpacity={0.15}
            linkDirectionalParticles={0}
            warmupTicks={60}
            cooldownTicks={200}
          />
        ) : null}
      </div>

      {/* Legend / toggleable labels */}
      <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-4 shadow-sm dark:shadow-none">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
          Toggle layers
        </div>
        <div className="flex flex-wrap gap-2">
          {typeCounts.map((t) => {
            const active = visibleTypes.has(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toggleType(t.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? "border-transparent text-white shadow-sm"
                    : "border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 bg-transparent"
                }`}
                style={active ? { backgroundColor: t.color } : undefined}
              >
                <span
                  className="block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: t.color, opacity: active ? 1 : 0.3 }}
                />
                {t.label}
                <span className={`${active ? "text-white/70" : "text-gray-400 dark:text-gray-600"}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          Click a label to show/hide that layer. Orange nodes are winning experiments. Click any experiment node to open its detail page.
        </p>
      </div>
    </div>
  );
}

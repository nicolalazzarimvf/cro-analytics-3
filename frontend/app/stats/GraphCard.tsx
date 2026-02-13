"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as ThreeLib from "three";
import { useTheme } from "@/app/context/ThemeContext";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

export type GraphData = {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    count: number;
    primary?: boolean;
    href?: string;
    previewUrl?: string;
    title?: string;
  }>;
  links: Array<{ source: string; target: string; value: number }>;
};

type GraphContext = "stats" | "experiment";

export default function GraphCard({
  data,
  error,
  title = "Experiment graph",
  subtitle,
  context = "stats",
}: {
  data: GraphData | null;
  error?: string | null;
  title?: string;
  subtitle?: string;
  context?: GraphContext;
}) {
  const hasData = data && data.nodes.length > 0;
  const graphRef = useRef<any>(null);
  const THREE = ThreeLib;
  const searchParams = useSearchParams();
  const isBare = searchParams?.get("bare") === "1" || searchParams?.get("bare") === "true";

  // Responsive graph width
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(600);
  const measureWidth = useCallback(() => {
    if (containerRef.current) {
      setGraphWidth(containerRef.current.clientWidth);
    }
  }, []);
  useEffect(() => {
    measureWidth();
    window.addEventListener("resize", measureWidth);
    return () => window.removeEventListener("resize", measureWidth);
  }, [measureWidth]);

  // Theme-aware graph background
  const { currentTheme } = useTheme();
  const graphBg = currentTheme === "dark" ? "#1f2937" : "#ffffff";

  useEffect(() => {
    if (hasData && graphRef.current) {
      try {
        graphRef.current.zoomToFit(600, 80);
      } catch {
        // ignore zoom errors
      }
    }
  }, [hasData, data]);

  // Extract similar experiment nodes and attribute nodes for clickable lists
  const experimentNodes = data?.nodes.filter(
    (n) => n.type === "experiment" && !n.primary && n.href,
  ) ?? [];
  const primaryNode = data?.nodes.find((n) => n.primary);
  const attributeNodes = data?.nodes.filter(
    (n) => n.type !== "experiment",
  ) ?? [];

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {subtitle ?? "Change type → element relationships"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700/60 px-3 py-1">
          <span className="block h-3 w-3 rounded-sm bg-orange-500" aria-hidden />
          <span>{context === "experiment" ? "This experiment" : "Top winner"}</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700/60 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-blue-500" aria-hidden />
          <span>Change type</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700/60 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-emerald-500" aria-hidden />
          <span>Element</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700/60 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-purple-500" aria-hidden />
          <span>Vertical / Geo / Brand / Metric</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700/60 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-gray-500" aria-hidden />
          <span>Similar experiments</span>
        </div>
      </div>

      {!hasData ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-6 text-sm text-gray-600 dark:text-gray-400">
          {error ? `Could not load graph: ${error}` : "No graph data available."}
        </div>
      ) : (
        <>
          <div ref={containerRef} className="relative mt-4 h-[440px] w-full overflow-hidden rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
            <ForceGraph3D
              ref={graphRef}
              graphData={data}
              width={graphWidth}
              height={420}
              backgroundColor={graphBg}
              controlType="orbit"
              enableNavigationControls
              showNavInfo={false}
              onEngineStop={() => {
                if (graphRef.current) {
                  try {
                    graphRef.current.zoomToFit(600, 80);
                  } catch {
                    // ignore
                  }
                }
              }}
              nodeColor={(node: any) => {
                if (node.primary) return "#f97316";
                switch ((node.type ?? "").toLowerCase()) {
                  case "change":
                    return "#3b82f6";
                  case "element":
                    return "#10b981";
                  case "vertical":
                  case "geo":
                  case "brand":
                  case "metric":
                    return "#a855f7";
                  case "experiment":
                  default:
                    return "#6b7280";
                }
              }}
              nodeLabel={(n: any) => {
                if (n.title) return `${n.label} — ${n.title}`;
                return n.label || n.id;
              }}
              nodeThreeObject={(node: any) => {
                if (!node?.primary) return undefined;
                const size = Math.max(6, Math.min(14, (node.count ?? 2) * 1.2));
                const geometry = new THREE.BoxGeometry(size, size, size);
                const material = new THREE.MeshStandardMaterial({
                  color: "#f97316",
                  metalness: 0.2,
                  roughness: 0.4,
                });
                return new THREE.Mesh(geometry, material);
              }}
              nodeVal={(n: any) => Math.max(4, Math.min(12, (n.count ?? 1) * 0.8))}
              linkWidth={(l: any) => Math.max(1, Math.min(6, (l.value ?? 1) * 0.6))}
              linkDirectionalParticles={1}
              linkDirectionalParticleSpeed={0.006}
              warmupTicks={30}
              cooldownTicks={100}
            />
          </div>

          {/* Attributes */}
          {attributeNodes.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Attributes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {attributeNodes.map((n) => {
                  const colorMap: Record<string, string> = {
                    change: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
                    element: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
                    vertical: "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
                    geo: "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
                    brand: "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
                    metric: "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
                  };
                  const cls = colorMap[n.type] ?? "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600";
                  return (
                    <span
                      key={n.id}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
                    >
                      <span className="text-[10px] opacity-60 uppercase">{n.type}</span>
                      {n.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Similar experiments list */}
          {experimentNodes.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Similar experiments ({experimentNodes.length})
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {experimentNodes.map((n) => (
                  <Link
                    key={n.id}
                    href={isBare ? `${n.href!}${n.href!.includes("?") ? "&" : "?"}bare=1` : n.href!}
                    className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-blue-700 dark:text-blue-300">{n.label}</div>
                      {n.title ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{n.title}</div>
                      ) : null}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

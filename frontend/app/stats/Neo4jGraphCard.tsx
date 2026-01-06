"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ThreeLib from "three";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

export type Neo4jGraphData = {
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

export default function Neo4jGraphCard({
  data,
  error,
  title = "Neo4j 3D view",
  subtitle,
  context = "stats"
}: {
  data: Neo4jGraphData | null;
  error?: string | null;
  title?: string;
  subtitle?: string;
  context?: GraphContext;
}) {
  const hasData = data && data.nodes.length > 0;
  const [hovered, setHovered] = useState<{
    label: string;
    href?: string;
    title?: string;
  } | null>(null);
  const graphRef = useRef<any>(null);
  // Reuse a single THREE instance to avoid duplicate-three warnings.
  const THREE = useMemo(() => {
    const existing = (globalThis as any).THREE as typeof ThreeLib | undefined;
    if (existing) return existing;
    (globalThis as any).THREE = ThreeLib;
    return ThreeLib;
  }, []);

  useEffect(() => {
    if (hasData && graphRef.current) {
      try {
        graphRef.current.zoomToFit(600, 80);
      } catch {
        // ignore zoom errors
      }
    }
  }, [hasData, data]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-600">
            {subtitle ?? "Change type → element relationships (top 40)"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
          <span className="block h-3 w-3 rounded-sm bg-orange-500" aria-hidden />
          <span>{context === "experiment" ? "This experiment (cube)" : "Top winner (cube)"}</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-blue-500" aria-hidden />
          <span>Change type</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-emerald-500" aria-hidden />
          <span>Element</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-purple-500" aria-hidden />
          <span>Vertical / Geo / Brand / Metric</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
          <span className="block h-3 w-3 rounded-full bg-gray-500" aria-hidden />
          <span>{context === "experiment" ? "Similar experiments" : "Similar experiments"}</span>
        </div>
      </div>

      {!hasData ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
          {error ? `Could not load Neo4j graph: ${error}` : "No graph data available."}
        </div>
      ) : (
        <div className="relative mt-4 h-[440px] w-full overflow-hidden rounded-xl border border-gray-100 bg-white">
          <ForceGraph3D
            ref={graphRef}
            graphData={data}
            width={800}
            height={420}
            backgroundColor="#ffffff"
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
                  return "#3b82f6"; // blue 500
                case "element":
                  return "#10b981"; // emerald 500
                case "vertical":
                case "geo":
                case "brand":
                case "metric":
                  return "#a855f7"; // purple 500
                case "experiment":
                default:
                  return "#6b7280"; // gray 500
              }
            }}
            nodeLabel={(n: any) => n.label || n.id}
            nodeThreeObject={(node: any) => {
              if (!node?.primary) return undefined;
              const size = Math.max(6, Math.min(14, (node.count ?? 2) * 1.2));
              const geometry = new THREE.BoxGeometry(size, size, size);
              const material = new THREE.MeshStandardMaterial({
                color: "#f97316",
                metalness: 0.2,
                roughness: 0.4
              });
              const mesh = new THREE.Mesh(geometry, material);
              return mesh;
            }}
            nodeVal={(n: any) => Math.max(4, Math.min(12, (n.count ?? 1) * 0.8))}
            linkWidth={(l: any) => Math.max(1, Math.min(6, (l.value ?? 1) * 0.6))}
            linkDirectionalParticles={1}
            linkDirectionalParticleSpeed={0.006}
            warmupTicks={30}
            cooldownTicks={100}
            onNodeHover={(node: any) => {
              if (node && node.type === "experiment") {
                setHovered({
                  label: node.label || node.id,
                  href: node.href,
                  title: node.title
                });
              } else {
                setHovered(null);
              }
            }}
            onNodeClick={(node: any) => {
              if (node?.href) {
                window.location.href = node.href;
              }
            }}
          />
          {hovered ? (
            <div className="absolute right-4 top-4 z-10 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="px-3 py-2">
                <div className="text-sm font-semibold text-gray-900">{hovered.label}</div>
                <div className="mt-1 text-xs text-gray-700">
                  {hovered.title ? hovered.title : "No title available."}
                </div>
                {hovered.href ? (
                  <div className="mt-2 text-[11px] text-gray-500">
                    Click the node in the graph to open the experiment.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {hasData ? (
        <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-700">
          <div className="font-semibold text-gray-900">
            {context === "experiment"
              ? "How to read this (example view of how this experiment connects in Neo4j)"
              : "How to read this (example view of how experiments connect in Neo4j)"}
          </div>
          {context === "experiment" ? (
            <ul className="mt-1 space-y-1">
              <li>Cube = this experiment; blue = change type; green = element; purple = vertical/geo/brand/metric; gray = similar experiments.</li>
              <li>Why similar experiments: first from <code>SIMILAR_TO</code>; if missing, we pick up to 6 experiments sharing change types with this experiment.</li>
              <li>How it’s fetched: we pull this experiment’s Neo4j neighborhood (change type, element, vertical, geo, brand, metric) and attach similar experiments.</li>
              <li>Interact: hover for ID/title; click experiment nodes to open their detail pages.</li>
              <li>What to infer: clusters around the same blue/green nodes suggest repeatable changes; gray nodes near a vertical/geo hint where the pattern generalizes.</li>
              <li className="font-semibold text-gray-900">If you don’t see gray nodes: this experiment may have no SIMILAR_TO or matching change-type links in Neo4j yet.</li>
            </ul>
          ) : (
          <ul className="mt-1 space-y-1">
            <li>Cube = top winner; blue = change type; green = element; purple = vertical/geo/brand/metric; gray = similar experiments.</li>
            <li>Why similar experiments: first from <code>SIMILAR_TO</code>; if missing, we pick up to 6 experiments sharing change types with the winner.</li>
            <li>How it’s fetched: we pull the winner’s Neo4j neighborhood (change type, element, vertical, geo, brand, metric) and attach similar experiments.</li>
            <li>Interact: hover for ID/title; click experiment nodes to open their detail pages.</li>
            <li>What to infer: clusters around the same blue/green nodes suggest repeatable winning changes; gray nodes near a vertical/geo hint where the pattern generalizes.</li>
            <li className="font-semibold text-gray-900">If you don’t see gray nodes: this winner may have no SIMILAR_TO or matching change-type links in Neo4j yet.</li>
          </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

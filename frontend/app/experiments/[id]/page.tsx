import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { ScreenshotList } from "./ScreenshotList";
import Neo4jGraphCard, { type Neo4jGraphData } from "@/app/stats/Neo4jGraphCard";
import { getNeo4jSession } from "@/lib/neo4j/client";

function formatDate(value: Date | null) {
  if (!value) return "—";
  return value.toISOString().slice(0, 10);
}

function formatMoney(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

export default async function ExperimentDetail({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const bare = Array.isArray(search.bare) ? search.bare[0] : search.bare;
  const isBare = bare === "1" || bare === "true";
  const from = Array.isArray(search.from) ? search.from[0] : search.from;
  const backHref = from === "stats" ? "/stats" : "/experiments";

  const experiment = await prisma.experiment.findUnique({
    where: { id },
    select: {
      experimentId: true,
      testName: true,
      vertical: true,
      geo: true,
      winningVar: true,
      monthlyExtrap: true,
      dateLaunched: true,
      dateConcluded: true,
      screenshotWebUrl: true,
      screenshotDriveFileId: true,
      screenshotThumbnailUrl: true,
      hypothesis: true,
      lessonLearned: true
    }
  });

  if (!experiment) {
    notFound();
  }

  let graphData: Neo4jGraphData | null = null;
  let graphError: string | null = null;
  if (experiment.experimentId) {
    const normalizeExpId = (v: string | null | undefined) => (v ?? "").trim();
    try {
      const session = await getNeo4jSession();
      try {
        const query = `
          MATCH (e:Experiment {experimentId: $experimentId})
          OPTIONAL MATCH (e)-[:HAS_CHANGE_TYPE]->(ct:ChangeType)
          OPTIONAL MATCH (e)-[:CHANGED_ELEMENT]->(el:ElementChanged)
          OPTIONAL MATCH (e)-[:IN_VERTICAL]->(v:Vertical)
          OPTIONAL MATCH (e)-[:IN_GEO]->(g:Geo)
          OPTIONAL MATCH (e)-[:FOR_BRAND]->(b:Brand)
          OPTIONAL MATCH (e)-[:TARGETS]->(tm:TargetMetric)
          OPTIONAL MATCH (e)-[:SIMILAR_TO]->(other:Experiment)
          WITH e, collect(DISTINCT ct) AS changeTypes, collect(DISTINCT el) AS elements,
               collect(DISTINCT v) AS verticals, collect(DISTINCT g) AS geos,
               collect(DISTINCT b) AS brands, collect(DISTINCT tm) AS metrics,
               collect(DISTINCT other)[0..6] AS closest
          RETURN e, changeTypes, elements, verticals, geos, brands, metrics, closest
        `;
        const result = await session.run(query, { experimentId: experiment.experimentId });
        if (result.records.length) {
          const record = result.records[0];
          const eNode = record.get("e") as any;
          const changeTypes = (record.get("changeTypes") as any[]) ?? [];
          const elements = (record.get("elements") as any[]) ?? [];
          const verticals = (record.get("verticals") as any[]) ?? [];
          const geos = (record.get("geos") as any[]) ?? [];
          const brands = (record.get("brands") as any[]) ?? [];
          const metrics = (record.get("metrics") as any[]) ?? [];
          let closest = (record.get("closest") as any[]) ?? [];

          if (!closest.length) {
            const fallbackClosest = await session.run(
              `
              MATCH (e:Experiment {experimentId: $experimentId})
              OPTIONAL MATCH (e)-[:HAS_CHANGE_TYPE]->(ct:ChangeType)<-[:HAS_CHANGE_TYPE]-(other:Experiment)
              WHERE other <> e
              WITH collect(DISTINCT other)[0..6] AS closest
              RETURN closest
              `,
              { experimentId: experiment.experimentId }
            );
            if (fallbackClosest.records.length) {
              closest = (fallbackClosest.records[0].get("closest") as any[]) ?? [];
            }
          }

          const closestIds = closest
            .map((n) => normalizeExpId(n?.properties?.experimentId as string | undefined))
            .filter(Boolean);
          const lookupIds = Array.from(
            new Set([normalizeExpId(experiment.experimentId), ...closestIds].filter(Boolean))
          );
          const metaRows = lookupIds.length
            ? await prisma.experiment.findMany({
                where: { experimentId: { in: lookupIds } },
                select: { id: true, experimentId: true, testName: true }
              })
            : [];
          const metaMap = new Map<
            string,
            { experimentId: string; id: string; testName: string | null }
          >(
            metaRows.map((row: { experimentId: string; id: string; testName: string | null }) => [
              normalizeExpId(row.experimentId),
              row
            ])
          );

          const nodesMap = new Map<
            string,
            {
              id: string;
              label: string;
              type: string;
              count: number;
              primary?: boolean;
              href?: string;
              title?: string;
            }
          >();
          const links: Neo4jGraphData["links"] = [];

          const expId = normalizeExpId(
            (eNode?.properties?.experimentId as string | undefined) ?? experiment.experimentId
          );
          nodesMap.set(expId, {
            id: expId,
            label: expId,
            type: "experiment",
            count: 3,
            primary: true,
            href: metaMap.get(expId)?.id ? `/experiments/${metaMap.get(expId)!.id}?from=experiments` : undefined,
            title: metaMap.get(expId)?.testName ?? experiment.testName ?? undefined
          });

          const pushNode = (node: any, type: string) => {
            const name = (node?.properties?.name as string | undefined)?.trim();
            if (!name) return;
            const normalizedType = type.toLowerCase();
            if (!nodesMap.has(name)) {
              nodesMap.set(name, { id: name, label: name, type: normalizedType, count: 1 });
            }
            links.push({ source: expId, target: name, value: 2 });
          };

          changeTypes.forEach((n) => pushNode(n, "change"));
          elements.forEach((n) => pushNode(n, "element"));
          verticals.forEach((n) => pushNode(n, "vertical"));
          geos.forEach((n) => pushNode(n, "geo"));
          brands.forEach((n) => pushNode(n, "brand"));
          metrics.forEach((n) => pushNode(n, "metric"));

          closest.forEach((n) => {
            const otherId = normalizeExpId(n?.properties?.experimentId as string | undefined);
            if (!otherId) return;
            const meta = metaMap.get(otherId);
            if (!nodesMap.has(otherId)) {
              nodesMap.set(otherId, {
                id: otherId,
                label: otherId,
                type: "experiment",
                count: 2,
                href: meta ? `/experiments/${meta.id}?from=experiments` : undefined,
                title: meta?.testName ?? undefined
              });
            }
            links.push({ source: expId, target: otherId, value: 3 });
          });

          if (links.length) {
            graphData = { nodes: Array.from(nodesMap.values()), links };
          }
        }
      } finally {
        await session.close();
      }
    } catch (err) {
      graphError = err instanceof Error ? err.message : "Unable to load Neo4j data";
    }
  }

  return (
    <main className={isBare ? "px-6 py-6" : "mx-auto max-w-4xl px-6 py-10"}>
      {isBare ? (
        <style>{`
          header,
          footer {
            display: none !important;
          }
          body {
            background: white;
          }
        `}</style>
      ) : null}
      {!isBare ? (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600">Experiment</p>
            <h1 className="text-2xl font-semibold text-gray-900">
              {experiment.experimentId || "—"}
            </h1>
            <p className="mt-1 text-gray-700">{experiment.testName || "Untitled test"}</p>
          </div>
          <Link
            href={backHref}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Back
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm text-gray-600">Vertical</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {experiment.vertical ?? "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm text-gray-600">Geo</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{experiment.geo ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm text-gray-600">Launched</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {formatDate(experiment.dateLaunched)}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm text-gray-600">Concluded</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {formatDate(experiment.dateConcluded)}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm sm:col-span-2">
          <div className="text-sm text-gray-600">Screenshots / Variations</div>
          <div className="mt-2">
            <ScreenshotList
              experimentId={experiment.experimentId}
              fallback={{
                webUrl: experiment.screenshotWebUrl,
                driveFileId: experiment.screenshotDriveFileId,
                thumbnailUrl: experiment.screenshotThumbnailUrl
              }}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm text-gray-600">Winner</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {experiment.winningVar?.trim() || "N.D."}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm text-gray-600">Monthly extrap</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {typeof experiment.monthlyExtrap === "number" ? formatMoney(experiment.monthlyExtrap) : "N.D."}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
          <h2 className="text-base font-semibold text-gray-900">Hypothesis</h2>
          <p className="mt-3 text-sm text-gray-700">
            {experiment.hypothesis?.trim() || "N.D."}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
          <h2 className="text-base font-semibold text-gray-900">Lessons learned</h2>
          <p className="mt-3 text-sm text-gray-700">
            {experiment.lessonLearned?.trim() || "N.D."}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <Neo4jGraphCard
          data={graphData}
          error={graphError}
          title="Neo4j connections for this experiment"
          subtitle="Direct relations and similar experiments"
          context="experiment"
        />
      </div>

    </main>
  );
}

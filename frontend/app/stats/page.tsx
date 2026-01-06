import Link from "next/link";
import neo4j from "neo4j-driver";
import { prisma } from "@/lib/db/client";
import { getNeo4jSession } from "@/lib/neo4j/client";
import AskAI from "@/app/components/AskAI";
import Neo4jGraphCard, { type Neo4jGraphData } from "./Neo4jGraphCard";

function startOfUtcMonth(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

function startOfUtcNextMonth(date: Date) {
  return startOfUtcMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function formatDate(value: Date | null) {
  if (!value) return "—";
  const iso = value.toISOString();
  return iso.slice(0, 10);
}

function formatMonthLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function normalizeWinner(value: string | null) {
  return (value ?? "N.D.").trim() || "N.D.";
}

type ExperimentRow = {
  id: string;
  experimentId: string;
  testName: string | null;
  vertical: string | null;
  geo: string | null;
  dateLaunched: Date | null;
  dateConcluded: Date | null;
  winningVar: string | null;
  monthlyExtrap: number | null;
  screenshotWebUrl: string | null;
  screenshotThumbnailUrl: string | null;
};

function PaginationControls({
  page,
  totalPages,
  totalInMode,
  hasPrev,
  hasNext
}: {
  page: number;
  totalPages: number;
  totalInMode: number;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-sm text-gray-600">
        Page {page} of {totalPages} · {totalInMode} total
      </div>
      <a
        href={`/stats?page=${Math.max(1, page - 1)}`}
        aria-disabled={!hasPrev}
        className={`rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${
          hasPrev ? "" : "pointer-events-none opacity-50"
        }`}
      >
        Prev
      </a>
      <a
        href={`/stats?page=${Math.min(totalPages, page + 1)}`}
        aria-disabled={!hasNext}
        className={`rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${
          hasNext ? "" : "pointer-events-none opacity-50"
        }`}
      >
        Next
      </a>
    </div>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StatsPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number(rawPage ?? "1") || 1);
  const pageSize = 25;

  const now = new Date();
  const defaultStartThisMonth = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth());
  const defaultStartPrevMonth = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth() - 1);

  const maxDates = await prisma.experiment.aggregate({
    _max: {
      dateConcluded: true,
      dateLaunched: true
    }
  });

  const defaultConcludedCount = await prisma.experiment.count({
    where: {
      dateConcluded: {
        gte: defaultStartPrevMonth,
        lt: defaultStartThisMonth
      }
    }
  });
  const defaultLaunchedCount = await prisma.experiment.count({
    where: {
      dateLaunched: {
        gte: defaultStartPrevMonth,
        lt: defaultStartThisMonth
      }
    }
  });

  const fallbackBaseDate = maxDates._max.dateConcluded ?? maxDates._max.dateLaunched ?? null;
  const useFallbackWindow = defaultConcludedCount === 0 && defaultLaunchedCount === 0 && !!fallbackBaseDate;

  const startThisMonth = useFallbackWindow
    ? startOfUtcNextMonth(fallbackBaseDate!)
    : defaultStartThisMonth;
  const startPrevMonth = useFallbackWindow
    ? startOfUtcMonth(fallbackBaseDate!.getUTCFullYear(), fallbackBaseDate!.getUTCMonth())
    : defaultStartPrevMonth;

  const [concludedCount, launchedCount] = await Promise.all([
    prisma.experiment.count({
      where: {
        dateConcluded: {
          gte: startPrevMonth,
          lt: startThisMonth
        }
      }
    }),
    prisma.experiment.count({
      where: {
        dateLaunched: {
          gte: startPrevMonth,
          lt: startThisMonth
        }
      }
    })
  ]);

  const modeLabel = concludedCount > 0 ? "concluded" : "launched";
  const hasConcludedInMonth = concludedCount > 0;
  const monthLabel = formatMonthLabel(startPrevMonth);

  const dateFilter =
    modeLabel === "concluded"
      ? {
          dateConcluded: {
            gte: startPrevMonth,
            lt: startThisMonth
          }
        }
      : {
          dateLaunched: {
            gte: startPrevMonth,
            lt: startThisMonth
          }
        };

  const skip = (page - 1) * pageSize;

  const [totalInMode, totalInMonth, verticalRows, geoRows, winnerCountRows, winnerExtrapRows] =
    await Promise.all([
      prisma.experiment.count({ where: dateFilter }),
      prisma.experiment.count({
        where: {
          OR: [
            {
              dateConcluded: {
                gte: startPrevMonth,
                lt: startThisMonth
              }
            },
            {
              dateLaunched: {
                gte: startPrevMonth,
                lt: startThisMonth
              }
            }
          ]
        }
      }),
      prisma.experiment.groupBy({
        by: ["vertical"],
        where: dateFilter,
        _count: { id: true }
      }),
      prisma.experiment.groupBy({
        by: ["geo"],
        where: dateFilter,
        _count: { id: true }
      }),
      prisma.experiment.groupBy({
        by: ["winningVar"],
        where: dateFilter,
        _count: { id: true }
      }),
      prisma.experiment.groupBy({
        by: ["winningVar"],
        where: dateFilter,
        _sum: { monthlyExtrap: true },
        _count: { id: true }
      })
    ]);

  const verticals = verticalRows
    .map((r: { vertical: string | null; _count: { id: number } }) => [r.vertical ?? "Unknown", r._count.id] as const)
    .sort((a: readonly [string, number], b: readonly [string, number]) => b[1] - a[1])
    .slice(0, 12);
  const geos = geoRows
    .map((r: { geo: string | null; _count: { id: number } }) => [r.geo ?? "Unknown", r._count.id] as const)
    .sort((a: readonly [string, number], b: readonly [string, number]) => b[1] - a[1])
    .slice(0, 12);
  const winnersByCount = winnerCountRows
    .map((r: { winningVar: string | null; _count: { id: number } }) => [normalizeWinner(r.winningVar), r._count.id] as const)
    .sort((a: readonly [string, number], b: readonly [string, number]) => b[1] - a[1])
    .slice(0, 12);

  const uniqueVerticals = verticalRows.filter((r: { vertical: string | null }) => (r.vertical ?? "").trim()).length;
  const uniqueGeos = geoRows.filter((r: { geo: string | null }) => (r.geo ?? "").trim()).length;

  const winnerExtrap = winnerExtrapRows
    .map(
      (r: { winningVar: string | null; _sum: { monthlyExtrap: number | null }; _count: { id: number } }) => ({
        winner: normalizeWinner(r.winningVar),
        sum: r._sum.monthlyExtrap ?? 0,
        count: r._count.id
      })
    )
    .sort((a: { winner: string; sum: number; count: number }, b: { winner: string; sum: number; count: number }) => b.sum - a.sum);

  const winnerExtrapNonZero = winnerExtrap.filter(
    (r: { winner: string; sum: number; count: number }) => r.winner !== "N.D." && r.sum > 0
  );

  const [missingWinnerVarCount, missingMonthlyExtrapCount] = await Promise.all([
    prisma.experiment.count({
      where: {
        ...dateFilter,
        OR: [{ winningVar: null }, { winningVar: "" }]
      }
    }),
    prisma.experiment.count({
      where: {
        ...dateFilter,
        monthlyExtrap: null
      }
    })
  ]);

const winnerLabels = (winnerExtrapNonZero.length ? winnerExtrapNonZero.slice(0, 12) : [])
  .map((r: { winner: string; sum: number; count: number }) => r.winner)
  .filter((w: string) => w !== "Unknown");
const topExperimentPerWinner = winnerLabels.length
  ? await prisma.experiment.findMany({
        where: {
          ...dateFilter,
          winningVar: { in: winnerLabels }
        },
        orderBy: [{ monthlyExtrap: "desc" }],
        distinct: ["winningVar"],
        select: {
          id: true,
      winningVar: true,
      experimentId: true,
      monthlyExtrap: true
    }
  })
  : [];
  const topExperimentMap = new Map<string, { id: string; experimentId: string }>(
    topExperimentPerWinner.map((e: { id: string; experimentId: string; winningVar: string | null }) => [
      normalizeWinner(e.winningVar),
      { id: e.id, experimentId: e.experimentId }
    ])
  );

const totalMonthlyExtrap = winnerExtrap.reduce(
  (acc: number, r: { winner: string; sum: number; count: number }) => acc + r.sum,
  0
  );
  const hasMonthlyExtrap = totalMonthlyExtrap > 0;
  const topWinnerByExtrap = winnerExtrap[0] ?? null;
  const topWinnerExperiment = topWinnerByExtrap ? topExperimentMap.get(topWinnerByExtrap.winner) : null;
  const normalizeExpId = (v: string | null | undefined) => (v ?? "").trim();

  const experiments = await prisma.experiment.findMany({
    where: dateFilter,
    select: {
      id: true,
      experimentId: true,
      testName: true,
      vertical: true,
      geo: true,
      winningVar: true,
      monthlyExtrap: true,
      dateLaunched: true,
      dateConcluded: true,
      screenshotWebUrl: true,
      screenshotThumbnailUrl: true
    },
    orderBy: modeLabel === "concluded" ? { dateConcluded: "desc" } : { dateLaunched: "desc" },
    skip,
    take: pageSize
  });
  const totalPages = Math.max(1, Math.ceil(totalInMode / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const fallbackPreviewMap = new Map<
    string,
    { id: string; experimentId: string; testName: string | null; screenshotThumbnailUrl: string | null; screenshotWebUrl: string | null }
  >(
    experiments.map(
      (e: {
        id: string;
        experimentId: string;
        testName: string | null;
        screenshotThumbnailUrl: string | null;
        screenshotWebUrl: string | null;
      }) => [
        normalizeExpId(e.experimentId),
        {
          id: e.id,
          experimentId: e.experimentId,
          testName: e.testName ?? null,
          screenshotThumbnailUrl: e.screenshotThumbnailUrl,
          screenshotWebUrl: e.screenshotWebUrl
        }
      ]
    )
  );

  let neo4jGraphData: Neo4jGraphData | null = null;
  let neo4jGraphError: string | null = null;
  if (topWinnerExperiment?.experimentId) {
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
          WITH e, collect(DISTINCT ct) AS changeTypes, collect(DISTINCT el) AS elements,
                 collect(DISTINCT v) AS verticals, collect(DISTINCT g) AS geos,
                 collect(DISTINCT b) AS brands, collect(DISTINCT tm) AS metrics
          OPTIONAL MATCH (e)-[:SIMILAR_TO]->(other:Experiment)
          WITH e, changeTypes, elements, verticals, geos, brands, metrics,
               other
          ORDER BY coalesce(other.monthlyExtrap, 0) DESC
          WITH e, changeTypes, elements, verticals, geos, brands, metrics,
               collect(DISTINCT other)[0..6] AS closest
          RETURN e, changeTypes, elements, verticals, geos, brands, metrics, closest
        `;
        const result = await session.run(query, { experimentId: topWinnerExperiment.experimentId });
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
              WITH e, collect(DISTINCT other) AS pool
              RETURN pool[0..6] AS closest
              `,
              { experimentId: topWinnerExperiment.experimentId }
            );
            if (fallbackClosest.records.length) {
              closest = (fallbackClosest.records[0].get("closest") as any[]) ?? [];
            }
          }

          // If we still have fewer than 6, top up with other experiments sharing change types.
          if (closest.length < 6) {
            const excludeIds = closest
              .map((n) => normalizeExpId(n?.properties?.experimentId as string | undefined))
              .filter(Boolean);
            excludeIds.push(normalizeExpId(topWinnerExperiment.experimentId));
            const toTake = Math.max(0, Math.floor(6 - closest.length));
            const moreSimilar = await session.run(
              `
              MATCH (e:Experiment {experimentId: $experimentId})
              OPTIONAL MATCH (e)-[:HAS_CHANGE_TYPE]->(ct:ChangeType)<-[:HAS_CHANGE_TYPE]-(other:Experiment)
              WHERE other <> e AND other.experimentId IS NOT NULL AND NOT other.experimentId IN $exclude
              WITH DISTINCT other
              ORDER BY coalesce(other.monthlyExtrap, 0) DESC
              LIMIT $limit
              RETURN collect(other) AS extra
              `,
              {
                experimentId: topWinnerExperiment.experimentId,
                exclude: excludeIds,
                limit: neo4j.int(toTake)
              }
            );
            if (moreSimilar.records.length) {
              const extra = (moreSimilar.records[0].get("extra") as any[]) ?? [];
              const merged = [...closest, ...extra];
              const seen = new Set<string>();
              closest = merged.filter((n) => {
                const id = normalizeExpId(n?.properties?.experimentId as string | undefined);
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
              });
            }
          }

          const closestExperimentIds = closest
            .map((n) => normalizeExpId(n?.properties?.experimentId as string | undefined))
            .filter(Boolean);
          const candidateExperimentIds = Array.from(
            new Set(
              [normalizeExpId(topWinnerExperiment.experimentId), ...closestExperimentIds].filter(
                Boolean
              )
            )
          );
          const experimentPreviewRows = candidateExperimentIds.length
            ? await prisma.experiment.findMany({
                where: { experimentId: { in: candidateExperimentIds } },
                select: {
                  id: true,
                  experimentId: true,
                  testName: true,
                  screenshotThumbnailUrl: true,
                  screenshotWebUrl: true
                }
              })
            : [];
          const experimentPreviewMap = new Map<
            string,
            { id: string; experimentId: string; testName: string | null; screenshotThumbnailUrl: string | null; screenshotWebUrl: string | null }
          >(
            experimentPreviewRows.map((r: { id: string; experimentId: string; testName: string | null; screenshotThumbnailUrl: string | null; screenshotWebUrl: string | null }) => [
              normalizeExpId(r.experimentId),
              {
                id: r.id,
                experimentId: r.experimentId,
                testName: r.testName ?? null,
                screenshotThumbnailUrl: r.screenshotThumbnailUrl,
                screenshotWebUrl: r.screenshotWebUrl
              }
            ])
          );
          // merge fallback previews from current page if not already set
          fallbackPreviewMap.forEach(
            (
              value: {
                id: string;
                experimentId: string;
                testName: string | null;
                screenshotThumbnailUrl: string | null;
                screenshotWebUrl: string | null;
              },
              key: string
            ) => {
            if (!experimentPreviewMap.has(key)) {
              experimentPreviewMap.set(key, value);
            }
            }
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
              previewUrl?: string;
              title?: string;
            }
          >();
          const links: Neo4jGraphData["links"] = [];
          const allowedNodeLabels = new Set([
            "ChangeType",
            "ElementChanged",
            "Vertical",
            "Geo",
            "Brand",
            "TargetMetric",
            "Experiment"
          ]);

          const expId = normalizeExpId(eNode?.properties?.experimentId ?? topWinnerExperiment.experimentId);
          nodesMap.set(expId, {
            id: expId,
            label: `${expId}`,
            type: "experiment",
            count: 3,
            primary: true,
            href:
              experimentPreviewMap.get(expId)?.id != null
                ? `/experiments/${experimentPreviewMap.get(expId)!.id}?from=stats`
                : undefined,
            title: experimentPreviewMap.get(expId)?.testName ?? undefined
          });

          const pushNode = (node: any, type: string) => {
            const labels: string[] = Array.isArray(node?.labels) ? node.labels : [];
            if (labels.length && !labels.some((lbl) => allowedNodeLabels.has(lbl))) return;
            const props = (node?.properties ?? {}) as Record<string, unknown>;
            const rawName =
              (props.name as string | undefined)?.trim() ||
              (props.code as string | undefined)?.trim() ||
              (props.id as string | undefined)?.trim() ||
              `${type} unknown`;
            const normalizedType = type.toLowerCase();
            if (!nodesMap.has(rawName)) {
              nodesMap.set(rawName, { id: rawName, label: rawName, type: normalizedType, count: 1 });
            }
            links.push({ source: expId, target: rawName, value: 2 });
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
            const meta = experimentPreviewMap.get(otherId);
            if (!nodesMap.has(otherId)) {
              nodesMap.set(otherId, {
                id: otherId,
                label: `${otherId}`,
                type: "experiment",
                count: 2,
                href: meta ? `/experiments/${meta.id}?from=stats` : undefined,
                title: meta?.testName ?? undefined
              });
            }
            links.push({ source: expId, target: otherId, value: 3 });
          });

          if (links.length) {
            const nodes = Array.from(nodesMap.values()).filter((n) => {
              const label = n.label.toLowerCase();
              return n.type !== "tag" && !label.includes("tag");
            });
            const allowed = new Set(nodes.map((n) => n.id));
            const filteredLinks = links.filter((l) => allowed.has(l.source as string) && allowed.has(l.target as string));
            neo4jGraphData = { nodes, links: filteredLinks };
          }
        }
      } finally {
        await session.close();
      }
    } catch (err) {
      neo4jGraphError = err instanceof Error ? err.message : "Unable to load Neo4j data";
    }
  } else {
    neo4jGraphError = "No top winner in this window.";
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-600">
          Recap for <span className="font-medium">{monthLabel}</span>{" "}
          {useFallbackWindow ? (
            <span className="text-gray-500">(latest month with data)</span>
          ) : (
            <span className="text-gray-500">(last completed month)</span>
          )}
        </p>
      </div>

      <div className="mt-4">
        <AskAI />
      </div>

      {useFallbackWindow ? (
        <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          No experiments found for the last completed calendar month. This recap is based on the
          most recent month present in your imported data.
        </div>
      ) : null}

      {!hasConcludedInMonth ? (
        <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          No experiments have a <code>dateConcluded</code> in this month window. Showing stats by{" "}
          <code>dateLaunched</code> instead.
        </div>
      ) : null}
      {missingWinnerVarCount > 0 || missingMonthlyExtrapCount > 0 ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          Data quality in this month:{" "}
          <span className="font-medium">{missingWinnerVarCount}</span> rows missing{" "}
          <code>Winning var</code>,{" "}
          <span className="font-medium">{missingMonthlyExtrapCount}</span> rows missing{" "}
          <code>monthly extrap</code>.
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">Experiments in month</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{totalInMonth}</div>
          <div className="mt-1 text-xs text-gray-500">launched or concluded</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">Concluded</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{concludedCount}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">Launched</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{launchedCount}</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">Mode</div>
          <div className="mt-2 text-lg font-semibold text-gray-900">
            By <span className="capitalize">{modeLabel}</span> date
          </div>
          <div className="mt-1 text-xs text-gray-500">used for breakdowns below</div>
        </div>
        <div className="mt-4 flex items-center justify-end">
          <PaginationControls
            page={page}
            totalPages={totalPages}
            totalInMode={totalInMode}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">Top verticals</div>
          <div className="mt-2 grid gap-2 text-sm">
            {verticals.slice(0, 3).map(([k, v]: readonly [string, number], idx: number) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">{idx + 1}</span>
                  <span className="font-medium text-gray-900">{k}</span>
                </div>
                <span className="font-semibold text-gray-900">{v}</span>
              </div>
            ))}
            {!verticals.length ? (
              <div className="text-gray-600">No data for this month.</div>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">Top geos</div>
          <div className="mt-2 grid gap-2 text-sm">
            {geos.slice(0, 3).map(([k, v]: readonly [string, number], idx: number) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">{idx + 1}</span>
                  <span className="font-medium text-gray-900">{k}</span>
                </div>
                <span className="font-semibold text-gray-900">{v}</span>
              </div>
            ))}
            {!geos.length ? (
              <div className="text-gray-600">No data for this month.</div>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">
            Top winners {hasMonthlyExtrap ? "(by monthly extrap)" : "(by count)"}
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            {winnerExtrapNonZero.length ? (
              winnerExtrapNonZero.slice(0, 3).map((r: { winner: string; sum: number; count: number }) => {
                const topExperiment = topExperimentMap.get(r.winner);
                return (
                  <div key={r.winner} className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-gray-900">{r.winner}</div>
                      <div className="text-xs text-gray-500">
                        Top experiment:{" "}
                        {topExperiment ? (
                    <Link
                      href={`/experiments/${topExperiment.id}?from=stats`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                            {topExperiment.experimentId}
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-700">—</span>
                        )}
                      </div>
                    </div>
                    <div className="font-semibold text-gray-900">{formatMoney(r.sum)}</div>
                  </div>
                );
              })
            ) : winnersByCount.length ? (
              winnersByCount.slice(0, 3).map(([winner, count]: readonly [string, number]) => (
                <div key={winner} className="flex items-start justify-between gap-4">
                  <div className="font-semibold text-gray-900">{winner}</div>
                  <div className="font-semibold text-gray-900">{count} rows</div>
                </div>
              ))
            ) : (
              <div className="text-gray-600">No data for this month.</div>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-sm">
          <div className="text-sm font-medium text-gray-600">
            {hasMonthlyExtrap ? "Total monthly extrap" : "Rows analysed"}
          </div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">
            {hasMonthlyExtrap ? formatMoney(totalMonthlyExtrap) : totalInMode}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {hasMonthlyExtrap ? "sum across winners" : "rows in this window"}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
          <h2 className="text-base font-semibold text-gray-900">Vertical breakdown</h2>
          <div className="mt-4 grid gap-2 text-sm">
            {verticals.length ? (
              verticals.map(([k, v]: readonly [string, number]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 pb-2 last:border-b-0"
                >
                  <span className="text-gray-700">{k}</span>
                  <span className="font-medium text-gray-900">{v}</span>
                </div>
              ))
            ) : (
              <div className="text-gray-600">No data for this month.</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
          <h2 className="text-base font-semibold text-gray-900">Geo breakdown</h2>
          <div className="mt-4 grid gap-2 text-sm">
            {geos.length ? (
              geos.map(([k, v]: readonly [string, number]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 border-b border-gray-100 pb-2 last:border-b-0"
                >
                  <span className="text-gray-700">{k}</span>
                  <span className="font-medium text-gray-900">{v}</span>
                </div>
              ))
            ) : (
              <div className="text-gray-600">No data for this month.</div>
            )}
          </div>
        </div>

      </div>

      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-gray-900">Experiments ({modeLabel})</h2>
          <PaginationControls
            page={page}
            totalPages={totalPages}
            totalInMode={totalInMode}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-600">
                <th className="px-3 py-2 font-medium">Experiment</th>
                <th className="px-3 py-2 font-medium">Test</th>
                <th className="px-3 py-2 font-medium">Vertical</th>
                <th className="px-3 py-2 font-medium">Geo</th>
                <th className="px-3 py-2 font-medium">Launched</th>
                <th className="px-3 py-2 font-medium">Concluded</th>
                <th className="px-3 py-2 font-medium">Winner</th>
                <th className="px-3 py-2 font-medium">Monthly extrap</th>
                <th className="px-3 py-2 font-medium">Screenshot</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((e: ExperimentRow) => (
                <tr key={e.id} className="border-b border-gray-100 text-gray-700">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    <Link
                      href={`/experiments/${e.id}?from=stats`}
                      className="text-brand-700 hover:underline"
                    >
                      {e.experimentId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/experiments/${e.id}?from=stats`}
                      className="text-brand-700 hover:underline"
                    >
                      {e.testName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{e.vertical ?? "—"}</td>
                  <td className="px-3 py-2">{e.geo ?? "—"}</td>
                  <td className="px-3 py-2">{formatDate(e.dateLaunched)}</td>
                  <td className="px-3 py-2">{formatDate(e.dateConcluded)}</td>
                  <td className="px-3 py-2">{e.winningVar?.trim() || "N.D."}</td>
                  <td className="px-3 py-2">
                    {typeof e.monthlyExtrap === "number" ? formatMoney(e.monthlyExtrap) : "N.D."}
                  </td>
                  <td className="px-3 py-2">
                    {e.screenshotWebUrl ? (
                      <a
                        href={e.screenshotWebUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-600 hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!experiments.length ? (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={9}>
                    No experiments found for this month window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-end">
          <PaginationControls
            page={page}
            totalPages={totalPages}
            totalInMode={totalInMode}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        </div>
      </div>

      <div className="mt-8">
        <Neo4jGraphCard
          data={neo4jGraphData}
          error={neo4jGraphError}
          title="Top winner spotlight (Neo4j)"
          subtitle={
            topWinnerExperiment
              ? `Graph neighborhood for ${topWinnerExperiment.experimentId}`
              : "No top winner available for this window"
          }
        />
      </div>
    </main>
  );
}

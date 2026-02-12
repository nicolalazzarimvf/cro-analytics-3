import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { ScreenshotList } from "./ScreenshotList";
import GraphCard, { type GraphData } from "@/app/stats/GraphCard";
import { buildExperimentGraph } from "@/lib/graph/postgres";

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
      launchedBy: true,
      vertical: true,
      geo: true,
      optimizelyLink: true,
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

  let graphData: GraphData | null = null;
  let graphError: string | null = null;
  if (experiment.experimentId) {
    try {
      const result = await buildExperimentGraph(
        experiment.experimentId,
        "experiment",
        6
      );
      if (result.nodes.length && result.links.length) {
        graphData = result;
      }
    } catch (err) {
      graphError = err instanceof Error ? err.message : "Unable to load graph data";
    }
  }

  return (
    <main className={isBare ? "px-6 py-6" : "mx-auto max-w-4xl px-6 py-10"}>
      {isBare ? (
        <style>{`
          /* Hide sidebar wrapper and dashboard header in bare/popup mode */
          #sidebar-wrapper,
          header {
            display: none !important;
          }
          /* Override body background for bare popup */
          html.dark body {
            background: #111827 !important;
          }
          html:not(.dark) body {
            background: #f9fafb !important;
          }
        `}</style>
      ) : null}
      {isBare ? (
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {experiment.testName || experiment.experimentId || "Experiment"}
          </h1>
          {experiment.testName && experiment.experimentId ? (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{experiment.experimentId}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Experiment</p>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {experiment.experimentId || "—"}
            </h1>
            <p className="mt-1 text-gray-700 dark:text-gray-300">{experiment.testName || "Untitled test"}</p>
            {experiment.optimizelyLink ? (
              <p className="mt-2 text-sm">
                <a
                  href={experiment.optimizelyLink}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View in Optimizely
                </a>
              </p>
            ) : null}
          </div>
          <Link
            href={backHref}
            className="rounded-lg border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            ← Back
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
          <div className="text-sm text-gray-600 dark:text-gray-400">Launched by</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {experiment.launchedBy?.trim() || "—"}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
            <div className="text-sm text-gray-600 dark:text-gray-400">Vertical</div>
            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {experiment.vertical ?? "—"}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
            <div className="text-sm text-gray-600 dark:text-gray-400">Geo</div>
            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{experiment.geo ?? "—"}</div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
          <div className="text-sm text-gray-600 dark:text-gray-400">Launched</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(experiment.dateLaunched)}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
          <div className="text-sm text-gray-600 dark:text-gray-400">Concluded</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(experiment.dateConcluded)}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none sm:col-span-2">
          <div className="text-sm text-gray-600 dark:text-gray-400">Screenshots / Variations</div>
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
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
          <div className="text-sm text-gray-600 dark:text-gray-400">Winner</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {experiment.winningVar?.trim() || "N.D."}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-theme-sm dark:shadow-none">
          <div className="text-sm text-gray-600 dark:text-gray-400">Monthly extrap</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {typeof experiment.monthlyExtrap === "number" ? formatMoney(experiment.monthlyExtrap) : "N.D."}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Hypothesis</h2>
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {experiment.hypothesis?.trim() || "N.D."}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-theme-sm dark:shadow-none">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Lessons learned</h2>
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {experiment.lessonLearned?.trim() || "N.D."}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <GraphCard
          data={graphData}
          error={graphError}
          title="Connections for this experiment"
          subtitle="Direct relations and similar experiments"
          context="experiment"
        />
      </div>

    </main>
  );
}

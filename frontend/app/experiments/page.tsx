import Link from "next/link";
import { prisma } from "@/lib/db/client";

type ExperimentRow = {
  id: string;
  experimentId: string;
  testName: string;
  vertical: string | null;
  geo: string | null;
  dateLaunched: Date | null;
  dateConcluded: Date | null;
  winningVar: string | null;
};

function formatDate(value: Date | null) {
  if (!value) return "—";
  return value.toISOString().slice(0, 10);
}

export default async function ExperimentsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const rawPageSize = Array.isArray(params.pageSize)
    ? params.pageSize[0]
    : params.pageSize;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;

  const page = Math.max(1, Number(rawPage ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(rawPageSize ?? "25") || 25));
  const query = (rawQuery ?? "").trim();

  const skip = (page - 1) * pageSize;
  const where =
    query && query.length
      ? {
          OR: [
            { experimentId: { contains: query, mode: "insensitive" as const } },
            { testName: { contains: query, mode: "insensitive" as const } },
            { vertical: { contains: query, mode: "insensitive" as const } },
            { geo: { contains: query, mode: "insensitive" as const } },
            { winningVar: { contains: query, mode: "insensitive" as const } }
          ]
        }
      : {};
  const [items, total] = await Promise.all([
    prisma.experiment.findMany({
      where,
      orderBy: { dateLaunched: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        experimentId: true,
        testName: true,
        vertical: true,
        geo: true,
        dateLaunched: true,
        dateConcluded: true,
        winningVar: true
      }
    }),
    prisma.experiment.count({ where })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-gray-600">Browse</p>
          <h1 className="text-2xl font-semibold text-gray-900">Experiments</h1>
          <p className="mt-1 text-sm text-gray-600">
            Page {page} of {totalPages} — showing {items.length} of {total} rows
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm text-gray-600" action="/experiments" method="get">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by ID, test name, geo, vertical, winner..."
            className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <input type="hidden" name="pageSize" value={pageSize} />
          <button
            type="submit"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50"
          >
            Search
          </button>
          {query ? (
            <Link
              href="/experiments"
              className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 font-medium text-gray-500 shadow-theme-xs hover:bg-gray-100"
            >
              Clear
            </Link>
          ) : null}
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">
            Page size: {pageSize}
          </span>
          <div className="flex items-center gap-2">
            <Link
              href={`/experiments?page=${Math.max(1, page - 1)}&pageSize=${pageSize}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
              aria-disabled={!hasPrev}
              className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                hasPrev
                  ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  : "border-gray-100 bg-gray-50 text-gray-400 pointer-events-none"
              }`}
            >
              ← Prev
            </Link>
            <Link
              href={`/experiments?page=${Math.min(totalPages, page + 1)}&pageSize=${pageSize}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
              aria-disabled={!hasNext}
              className={`rounded-lg border px-3 py-1.5 font-medium transition ${
                hasNext
                  ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  : "border-gray-100 bg-gray-50 text-gray-400 pointer-events-none"
              }`}
            >
              Next →
            </Link>
          </div>
        </form>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Experiment ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Test name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Vertical
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Geo
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Launched
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Concluded
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Winner
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-gray-900">
              {items.length ? (
                items.map((row: ExperimentRow) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-brand-700">
                      <Link href={`/experiments/${row.id}?from=experiments`} className="hover:underline">
                        {row.experimentId || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/experiments/${row.id}?from=experiments`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {row.testName || "Untitled test"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.vertical ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{row.geo ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(row.dateLaunched)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(row.dateConcluded)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                        {row.winningVar?.trim() || "N.D."}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-600">
                    No experiments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

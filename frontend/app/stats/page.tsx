import { prisma } from "@/lib/db/client";
import AskAI from "@/app/components/AskAI";

function startOfUtcMonth(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

function formatMonthLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function StatsPage() {
  const now = new Date();
  const startPrevMonth = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth() - 1);
  const startThisMonth = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth());
  const monthLabel = formatMonthLabel(startPrevMonth);

  // Fetch previous month experiments for default stats
  const rows = await prisma.experiment.findMany({
    where: {
      OR: [
        { dateConcluded: { gte: startPrevMonth, lt: startThisMonth } },
        { dateLaunched: { gte: startPrevMonth, lt: startThisMonth } },
      ],
    },
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
      changeType: true,
      elementChanged: true,
    },
    orderBy: { dateConcluded: "desc" },
  });

  // Serialize dates to strings for the client component
  const serializedRows = rows.map((r) => ({
    ...r,
    dateLaunched: r.dateLaunched?.toISOString() ?? null,
    dateConcluded: r.dateConcluded?.toISOString() ?? null,
    monthlyExtrap: r.monthlyExtrap ?? null,
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-600">
          Ask a question to explore experiment data, or browse the{" "}
          <span className="font-medium">{monthLabel}</span> recap below.
        </p>
      </div>

      <div className="mt-4">
        <AskAI
          defaultRows={serializedRows}
          defaultLabel={monthLabel}
        />
      </div>
    </main>
  );
}

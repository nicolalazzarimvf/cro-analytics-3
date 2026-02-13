import { prisma } from "@/lib/db/client";
import AskAI from "@/app/components/AskAI";


function startOfUtcMonth(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

function formatMonthLabel(date: Date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function pctChange(a: number, b: number) {
  if (b === 0) return a > 0 ? 100 : 0;
  return Math.round(((a - b) / Math.abs(b)) * 100);
}

export default async function StatsPage() {
  const now = new Date();
  const startPrevMonth = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth() - 1);
  const startThisMonth = startOfUtcMonth(now.getUTCFullYear(), now.getUTCMonth());
  const monthLabel = formatMonthLabel(startPrevMonth);

  // Build monthly buckets for the last 12 completed months (excluding current incomplete month)
  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 12; i >= 1; i--) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() - i;
    const start = startOfUtcMonth(y, m);
    const end = startOfUtcMonth(y, m + 1);
    const label = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    months.push({ start, end, label });
  }

  // Fetch experiments for KPI cards (last 12 completed months)
  const kpiExperiments = await prisma.experiment.findMany({
    where: {
      dateConcluded: { gte: months[0].start, lt: months[months.length - 1].end },
    },
    select: { dateConcluded: true, winningVar: true, monthlyExtrap: true },
  });

  const perMonth = months.map((m) => {
    const bucket = kpiExperiments.filter(
      (e) => e.dateConcluded && e.dateConcluded >= m.start && e.dateConcluded < m.end,
    );
    const total = bucket.length;
    const wins = bucket.filter(
      (e) => e.winningVar && e.winningVar.trim() !== "" && e.winningVar.trim().toLowerCase() !== "control",
    ).length;
    const revenue = bucket.reduce((sum, e) => sum + (e.monthlyExtrap ?? 0), 0);
    return { label: m.label, total, wins, winRate: total > 0 ? Math.round((wins / total) * 100) : 0, revenue };
  });

  const curr = perMonth[perMonth.length - 1];
  const prev = perMonth[perMonth.length - 2];
  const changeLabel = `${curr.label} vs ${prev.label}`;

  const cards = [
    {
      title: "Experiments",
      subtitle: "CONCLUDED",
      value: curr.total.toString(),
      change: pctChange(curr.total, prev.total),
      changeLabel,
      sparkline: perMonth.map((m) => m.total),
    },
    {
      title: "Win Rate",
      subtitle: "WINNERS",
      value: `${curr.winRate}%`,
      change: curr.winRate - prev.winRate,
      changeLabel,
      sparkline: perMonth.map((m) => m.winRate),
    },
    {
      title: "Revenue (All Tests)",
      subtitle: "MONTHLY EXTRAP",
      value: new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(curr.revenue),
      change: pctChange(curr.revenue, prev.revenue),
      changeLabel,
      sparkline: perMonth.map((m) => m.revenue),
    },
  ];

  const sparkLabels = perMonth.map((m) => m.label);

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
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          Dashboard
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-gray-500 dark:text-gray-400">
          Ask a question to explore experiment data, or browse the{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">{monthLabel}</span> recap below.
        </p>
      </div>

      <div className="mt-4">
        <AskAI
          defaultRows={serializedRows}
          defaultLabel={monthLabel}
          kpiCards={cards}
          kpiLabels={sparkLabels}
        />
      </div>
    </main>
  );
}

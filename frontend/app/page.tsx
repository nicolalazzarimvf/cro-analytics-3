import ImportAutoClient from "./ImportAutoClient";
import { prisma } from "@/lib/db/client";
import DashboardCards from "./components/DashboardCards";

function startOfUtcMonth(year: number, monthIndex0: number) {
  return new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0, 0));
}

export default async function HomePage() {
  const now = new Date();

  // Build monthly buckets for the last 6 months
  const months: { start: Date; end: Date; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() - i;
    const start = startOfUtcMonth(y, m);
    const end = startOfUtcMonth(y, m + 1);
    const label = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    months.push({ start, end, label });
  }

  // Fetch experiments concluded in the last 6 months
  const experiments = await prisma.experiment.findMany({
    where: {
      dateConcluded: { gte: months[0].start, lt: months[months.length - 1].end },
    },
    select: {
      dateConcluded: true,
      winningVar: true,
      monthlyExtrap: true,
    },
  });

  // Bucket experiments per month
  const perMonth = months.map((m) => {
    const bucket = experiments.filter(
      (e) => e.dateConcluded && e.dateConcluded >= m.start && e.dateConcluded < m.end,
    );
    const total = bucket.length;
    const wins = bucket.filter(
      (e) => e.winningVar && e.winningVar.trim() !== "" && e.winningVar.trim().toLowerCase() !== "control",
    ).length;
    const revenue = bucket.reduce((sum, e) => sum + (e.monthlyExtrap ?? 0), 0);
    return { label: m.label, total, wins, winRate: total > 0 ? Math.round((wins / total) * 100) : 0, revenue };
  });

  // Current month (last bucket) and previous month
  const curr = perMonth[perMonth.length - 1];
  const prev = perMonth[perMonth.length - 2];

  function pctChange(a: number, b: number) {
    if (b === 0) return a > 0 ? 100 : 0;
    return Math.round(((a - b) / b) * 100);
  }

  const cards = [
    {
      title: "Experiments",
      subtitle: "CONCLUDED",
      value: curr.total.toString(),
      change: pctChange(curr.total, prev.total),
      sparkline: perMonth.map((m) => m.total),
    },
    {
      title: "Win Rate",
      subtitle: "WINNERS",
      value: `${curr.winRate}%`,
      change: curr.winRate - prev.winRate,
      sparkline: perMonth.map((m) => m.winRate),
    },
    {
      title: "Revenue Impact",
      subtitle: "MONTHLY EXTRAP",
      value: new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(curr.revenue),
      change: pctChange(curr.revenue, prev.revenue),
      sparkline: perMonth.map((m) => m.revenue),
    },
  ];

  const sparkLabels = perMonth.map((m) => m.label);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          CRO Analyst
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-gray-500 dark:text-gray-400">
          AI-powered experiment intelligence — explore data, discover patterns, and get actionable insights to accelerate your CRO programme.
        </p>
      </div>

      {/* KPI cards */}
      <DashboardCards cards={cards} labels={sparkLabels} />

      {/* Auto-sync */}
      <div className="mt-8 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Auto-sync</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The latest experiments are imported automatically after login.
        </p>
        <div className="mt-4">
          <ImportAutoClient />
        </div>
      </div>
    </main>
  );
}

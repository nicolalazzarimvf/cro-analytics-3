"use client";

import { useId } from "react";

type Card = {
  title: string;
  subtitle: string;
  value: string;
  change: number;
  changeLabel?: string;
  sparkline: number[];
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const gradId = useId();
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 120;
  const h = 40;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });

  const fillPoints = [
    `${pad},${h}`,
    ...points,
    `${w - pad},${h}`,
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={fillPoints}
        fill={`url(#${gradId})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function DashboardCards({
  cards,
  labels,
}: {
  cards: Card[];
  labels: string[];
}) {
  const colors = ["#8b5cf6", "#10b981", "#3b82f6"];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card, i) => (
        <div
          key={card.title}
          className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-5 shadow-sm dark:shadow-none"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {card.subtitle}
              </div>
              <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {card.value}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              {card.change >= 0 ? (
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500">
                  +{card.change}%
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-500">
                  {card.change}%
                </span>
              )}
              {card.changeLabel ? (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{card.changeLabel}</span>
              ) : null}
            </div>
          </div>
          <div className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300">
            {card.title}
          </div>
          <div className="mt-3 h-10">
            <Sparkline data={card.sparkline} color={colors[i]} />
          </div>
        </div>
      ))}
    </div>
  );
}

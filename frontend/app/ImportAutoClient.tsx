"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ImportResult =
  | {
      ok: true;
      spreadsheetId: string;
      range: string;
      limit: number;
      upserted: number;
      skipped: number;
      totalRows: number;
      source?: string;
      driveLookups?: number;
    }
  | { error: string };

export default function ImportAutoClient() {
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);

  async function run() {
    setStatus("running");
    setResult(null);
    setProgress(10);

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProgress((p) => Math.min(92, p + Math.max(1, Math.round((Date.now() - startedAt) / 800))));
    }, 300);

    const res = await fetch("/api/import/auto", { method: "POST" });
    const contentType = res.headers.get("content-type") ?? "";
    let json: ImportResult;
    if (contentType.includes("application/json")) {
      json = (await res.json()) as ImportResult;
    } else {
      const text = await res.text().catch(() => "");
      const errorMsg = text.slice(0, 500) || `Request failed (${res.status})`;
      json = { 
        error: res.status === 504 
          ? "Import timed out. The process is taking too long. Try importing with fewer rows or check server logs."
          : errorMsg
      };
    }
    
    // If we got an error response, include it in the result
    if (!res.ok && "error" in json) {
      console.error("Import error:", json.error);
    }
    window.clearInterval(timer);
    setProgress(100);
    setResult(json);
    setStatus("done");
  }

  useEffect(() => {
    void run();
    // run once on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isRunning = status === "running";
  const ok = result && "ok" in result && result.ok;

  return (
    <div className="mx-auto w-full max-w-2xl">
      {isRunning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/90 px-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
            <h2 className="text-lg font-semibold text-gray-900">Syncing experiments…</h2>
            <p className="mt-2 text-sm text-gray-600">
              Importing the latest data from Google Sheets / Drive into Postgres.
            </p>

            <div className="mt-6">
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-gray-500">{progress}%</div>
            </div>
          </div>
        </div>
      ) : null}

      {status === "done" ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {ok ? "Experiments updated" : "Import failed"}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {ok
                  ? "Your database is up to date. Continue to stats for the last completed month."
                  : "Check your Google permissions and try again."}
              </p>
            </div>
            <button
              type="button"
              onClick={run}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Run again
            </button>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link
              href="/stats"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Go to stats
            </Link>
            <Link
              href="/experiments"
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              View experiments
            </Link>
          </div>

          {result ? (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                Import details
              </summary>
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-xs text-gray-800">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";

type PreviewResponse =
  | { ok: true; spreadsheetId: string; range: string; header: string[]; rows: string[][]; rowCount: number }
  | { error: string };

export default function SheetsClient() {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function runPreview() {
    setIsBusy(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/sheets/preview", { cache: "no-store" });
      const json = (await res.json()) as PreviewResponse;
      setPreview(json);
    } finally {
      setIsBusy(false);
    }
  }

  async function runImport() {
    setIsBusy(true);
    try {
      const res = await fetch("/api/import/sheets", { method: "POST" });
      setImportResult(await res.text());
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={runPreview}
          disabled={isBusy}
          className="rounded-lg border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Preview sheet
        </button>
        <button
          type="button"
          onClick={runImport}
          disabled={isBusy}
          className="rounded-lg border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Import (upsert) from sheet
        </button>
      </div>

      {preview ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-900/50 p-4 text-xs text-gray-800 dark:text-gray-200">
          {JSON.stringify(preview, null, 2)}
        </pre>
      ) : null}

      {importResult ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-900/50 p-4 text-xs text-gray-800 dark:text-gray-200">
          {importResult}
        </pre>
      ) : null}
    </div>
  );
}

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
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <button type="button" onClick={runPreview} disabled={isBusy}>
          Preview sheet
        </button>
        <button type="button" onClick={runImport} disabled={isBusy}>
          Import (upsert) from sheet
        </button>
      </div>

      {preview ? (
        <pre style={{ whiteSpace: "pre-wrap", padding: 12, background: "#f8fafc" }}>
          {JSON.stringify(preview, null, 2)}
        </pre>
      ) : null}

      {importResult ? (
        <pre style={{ whiteSpace: "pre-wrap", padding: 12, background: "#f8fafc" }}>
          {importResult}
        </pre>
      ) : null}
    </div>
  );
}

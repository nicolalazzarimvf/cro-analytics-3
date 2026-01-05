"use client";

import { useState, type FormEvent } from "react";

export default function ImportForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const res = await fetch("/api/import/csv", { method: "POST", body: formData });
      const text = await res.text();
      setResult(text);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <label>
        CSV file
        <input name="file" type="file" accept=".csv,text/csv" required />
      </label>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Importing…" : "Import"}
      </button>
      {result ? (
        <pre style={{ whiteSpace: "pre-wrap", padding: 12, background: "#f8fafc" }}>
          {result}
        </pre>
      ) : null}
    </form>
  );
}


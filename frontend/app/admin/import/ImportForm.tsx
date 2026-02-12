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
    <form onSubmit={onSubmit} className="mt-6 grid max-w-xl gap-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        CSV file
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="mt-2 block w-full rounded-lg border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 file:mr-4 file:rounded file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 dark:file:bg-gray-700 dark:file:text-gray-300"
        />
      </label>
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {isSubmitting ? "Importing…" : "Import"}
      </button>
      {result ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-900/50 p-4 text-xs text-gray-800 dark:text-gray-200">
          {result}
        </pre>
      ) : null}
    </form>
  );
}


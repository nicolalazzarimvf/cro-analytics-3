import ImportForm from "./ImportForm";

export default async function ImportCsvPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Import CSV</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Upload a CSV with headers: <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">experimentId</code>, <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">testName</code>,{" "}
        <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">vertical</code>, <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">geo</code>, <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">dateLaunched</code>,{" "}
        <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">dateConcluded</code>, <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">winningVar</code>.
      </p>
      <ImportForm />
    </main>
  );
}

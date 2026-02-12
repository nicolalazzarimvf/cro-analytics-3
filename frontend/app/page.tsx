import ImportAutoClient from "./ImportAutoClient";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          CROmatic
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-gray-500 dark:text-gray-400">
          AI-powered CRO analyst — explore experiment data, discover patterns, and get actionable insights to accelerate your programme.
        </p>
      </div>

      {/* Auto-sync */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 shadow-sm dark:shadow-none">
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

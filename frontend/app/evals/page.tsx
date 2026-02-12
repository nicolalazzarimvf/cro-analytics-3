import EvalsClient from "./EvalsClient";

export default function EvalsPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          AI Evals
        </h1>
        <p className="mt-3 max-w-3xl text-lg text-gray-500 dark:text-gray-400">
          Automated quality benchmarks — an independent GPT judge scores every AI response across
          accuracy, coverage, and actionability.
        </p>
      </div>
      <EvalsClient />
    </main>
  );
}

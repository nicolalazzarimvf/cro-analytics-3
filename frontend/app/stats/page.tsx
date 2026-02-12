import AskAI from "@/app/components/AskAI";

export default function StatsPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-600">
          Ask a question to explore and analyse experiment data.
        </p>
      </div>

      <div className="mt-4">
        <AskAI />
      </div>
    </main>
  );
}

import ImportAutoClient from "./ImportAutoClient";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-gray-900">Sync</h1>
      <p className="mt-2 text-sm text-gray-600">
        After login, the app automatically imports the latest experiments.
      </p>
      <div className="mt-6">
        <ImportAutoClient />
      </div>
    </main>
  );
}

import Link from "next/link";
import SheetsClient from "./SheetsClient";

export default function SheetsAdminPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Google Sheets</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Uses <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">GOOGLE_SHEETS_ID</code> / <code className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-sm">GOOGLE_SHEETS_RANGE</code> from
        env vars.
      </p>
      <SheetsClient />
      <p className="mt-6">
        <Link href="/admin" className="text-blue-600 dark:text-blue-400 hover:underline">Back to Admin</Link>
      </p>
    </main>
  );
}


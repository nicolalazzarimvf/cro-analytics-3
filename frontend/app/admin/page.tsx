import Link from "next/link";

export default async function AdminPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Admin</h1>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-gray-700 dark:text-gray-300">
        <li>
          <Link href="/admin/import" className="text-brand-600 hover:underline dark:text-brand-400">Import CSV</Link>
        </li>
        <li>
          <Link href="/admin/sheets" className="text-brand-600 hover:underline dark:text-brand-400">Google Sheets</Link>
        </li>
      </ul>
      <p className="mt-6">
        <Link href="/api/auth/signout" className="text-gray-600 dark:text-gray-400 hover:underline">Sign out</Link>
      </p>
    </main>
  );
}

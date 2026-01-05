import Link from "next/link";

export default async function AdminPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ margin: 0 }}>Admin</h1>
      <ul>
        <li>
          <Link href="/admin/import">Import CSV</Link>
        </li>
        <li>
          <Link href="/admin/sheets">Google Sheets</Link>
        </li>
      </ul>
      <p style={{ marginTop: 16 }}>
        <Link href="/api/auth/signout">Sign out</Link>
      </p>
    </main>
  );
}

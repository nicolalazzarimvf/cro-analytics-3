import Link from "next/link";
import SheetsClient from "./SheetsClient";

export default function SheetsAdminPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ margin: 0 }}>Google Sheets</h1>
      <p style={{ marginTop: 8 }}>
        Uses <code>GOOGLE_SHEETS_ID</code> / <code>GOOGLE_SHEETS_RANGE</code> from
        env vars.
      </p>
      <SheetsClient />
      <p style={{ marginTop: 16 }}>
        <Link href="/admin">Back to Admin</Link>
      </p>
    </main>
  );
}


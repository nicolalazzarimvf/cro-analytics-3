import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { importExperimentsFromSheet } from "@/lib/import/sheetsImport";

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
    });
    const accessToken = token?.accessToken;
    if (typeof accessToken !== "string" || !accessToken) {
      return NextResponse.json(
        { error: "Missing Google access token. Sign out and sign in again." },
        { status: 401 }
      );
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const rangeA1 = process.env.GOOGLE_SHEETS_RANGE ?? "A:ZZ";
    if (!spreadsheetId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEETS_ID" }, { status: 500 });
    }
    const gid = process.env.GOOGLE_SHEETS_GID ? Number(process.env.GOOGLE_SHEETS_GID) : undefined;

    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limitEnv = process.env.IMPORT_LIMIT ? Math.max(1, Number(process.env.IMPORT_LIMIT) || 0) : undefined;
    const limit = limitParam ? Math.max(1, Number(limitParam) || 0) : limitEnv;

    const result = await importExperimentsFromSheet({
      accessToken,
      spreadsheetId,
      rangeA1,
      gid,
      limit
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("import/sheets error", err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  fetchSheetValues,
  fetchSpreadsheetMetadata,
  quoteSheetTitleForA1
} from "@/lib/google/sheets";

export async function GET(request: NextRequest) {
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

  let effectiveRangeA1 = rangeA1;
  if (gid && !effectiveRangeA1.includes("!")) {
    const meta = await fetchSpreadsheetMetadata({ accessToken, spreadsheetId });
    const sheetTitle =
      meta.sheets?.find((s) => s.properties?.sheetId === gid)?.properties?.title ?? null;
    if (sheetTitle) {
      effectiveRangeA1 = `${quoteSheetTitleForA1(sheetTitle)}!${effectiveRangeA1}`;
    }
  }

  const data = await fetchSheetValues({ accessToken, spreadsheetId, rangeA1: effectiveRangeA1 });
  const values = data.values ?? [];
  const header = values[0] ?? [];
  const rows = values.slice(1, 51);

  return NextResponse.json({
    ok: true,
    spreadsheetId,
    range: data.range,
    header,
    rows,
    rowCount: Math.max(0, values.length - 1)
  });
}

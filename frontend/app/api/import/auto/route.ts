import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { importExperimentsFromSheet } from "@/lib/import/sheetsImport";

function pickAccessToken(req: NextRequest) {
  const internalKey = req.headers.get("x-internal-api-key");
  const expected = process.env.AI_INTERNAL_API_KEY;
  if (expected && internalKey === expected) {
    const svcToken = process.env.GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN;
    if (!svcToken) {
      throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN for internal import");
    }
    return svcToken;
  }
  // Fallback: if a service account token is configured, use it for cron without requiring a header.
  if (process.env.GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const internalToken = pickAccessToken(request);
    let accessToken = internalToken;

    if (!accessToken) {
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
      });
      accessToken = typeof token?.accessToken === "string" ? token.accessToken : null;
    }

    if (typeof accessToken !== "string" || !accessToken) {
      return NextResponse.json(
        { error: "Missing Google access token. Sign out and sign in again, or configure GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN + x-internal-api-key." },
        { status: 401 }
      );
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const rangeA1 = process.env.GOOGLE_SHEETS_RANGE ?? "A:ZZ";
    if (!spreadsheetId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEETS_ID" }, { status: 500 });
    }
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limitEnv = process.env.IMPORT_LIMIT ? Math.max(1, Number(process.env.IMPORT_LIMIT) || 0) : undefined;
    const limit = limitParam ? Math.max(1, Number(limitParam) || 0) : limitEnv;

    const result = await importExperimentsFromSheet({
      accessToken,
      spreadsheetId,
      rangeA1,
      limit
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("import/auto error", err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

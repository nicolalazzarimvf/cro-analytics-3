import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  thumbnailLink?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ experimentId: string }> }
) {
  const { experimentId } = await params;
  if (!experimentId) {
    return NextResponse.json({ error: "Missing experiment id" }, { status: 400 });
  }

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

  const query = `name contains '${experimentId}' and trashed = false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,thumbnailLink)");
  url.searchParams.set("orderBy", "name");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Drive search failed (${res.status})`, detail: text.slice(0, 500) },
      { status: res.status }
    );
  }

  const json = (await res.json()) as { files?: DriveFile[] };
  return NextResponse.json({
    files: (json.files ?? []).map((f) => ({
      id: f.id,
      name: f.name ?? "",
      mimeType: f.mimeType ?? "",
      webViewLink: f.webViewLink ?? "",
      thumbnailLink: f.thumbnailLink ?? ""
    }))
  });
}

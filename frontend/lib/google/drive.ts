export type DriveFileMetadata = {
  id: string;
  name?: string;
  webViewLink?: string;
  thumbnailLink?: string;
};

export function extractDriveFileId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Plain file id (most common)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }

  // https://drive.google.com/file/d/<id>/view?...
  const fileMatch = trimmed.match(/\/file\/d\/([^/]+)/);
  if (fileMatch?.[1]) return fileMatch[1];

  // https://drive.google.com/open?id=<id>
  const urlMatch = trimmed.match(/[?&]id=([^&]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  return null;
}

export async function fetchDriveFileMetadata(options: {
  accessToken: string;
  fileId: string;
}) {
  const { accessToken, fileId } = options;

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,webViewLink,thumbnailLink");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Drive API error (${res.status}): ${body.slice(0, 500)}`);
  }

  return (await res.json()) as DriveFileMetadata;
}

export async function exportGoogleSheetToCsv(options: {
  accessToken: string;
  spreadsheetId: string;
}) {
  const { accessToken, spreadsheetId } = options;

  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/export`
  );
  url.searchParams.set("mimeType", "text/csv");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Drive export error (${res.status}): ${body.slice(0, 500)}`);
  }

  return await res.text();
}

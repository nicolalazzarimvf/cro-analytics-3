export type SheetValuesResponse = {
  range: string;
  majorDimension: "ROWS" | "COLUMNS";
  values?: string[][];
};

export type SpreadsheetMetadata = {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
};

export function normalizeA1Range(raw: string) {
  let value = raw.trim();

  // Be resilient to accidental env concatenations or quotes.
  value = value.replace(/^"+|"+$/g, "");
  value = value.replace(/[\r\n]/g, "");
  value = value.split("NEXTAUTH_")[0] ?? value;

  // If an env file got concatenated (e.g. `A:ZZ"NEXTAUTH_SECRET=...`), strip the extra assignment.
  value = value.replace(/\s+[A-Z0-9_]+=.*/, "");

  return value || "A:ZZ";
}

export function parseSpreadsheetUrl(urlString: string) {
  const url = new URL(urlString);
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  const spreadsheetId = match?.[1];
  const gidRaw = url.searchParams.get("gid");
  const gid = gidRaw ? Number(gidRaw) : undefined;

  if (!spreadsheetId) {
    throw new Error("Invalid Google Sheets URL: missing spreadsheet id");
  }

  return { spreadsheetId, gid: Number.isFinite(gid) ? gid : undefined };
}

export function quoteSheetTitleForA1(title: string) {
  // Safest: always quote and escape single quotes as per Sheets A1 notation.
  return `'${title.replaceAll("'", "''")}'`;
}

export async function fetchSpreadsheetMetadata(options: {
  accessToken: string;
  spreadsheetId: string;
}) {
  const { accessToken, spreadsheetId } = options;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  );
  url.searchParams.set("fields", "sheets(properties(sheetId,title))");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets metadata error (${res.status}): ${body.slice(0, 500)}`);
  }

  return (await res.json()) as SpreadsheetMetadata;
}

export async function fetchSheetValues(options: {
  accessToken: string;
  spreadsheetId: string;
  rangeA1: string;
}) {
  const { accessToken, spreadsheetId } = options;
  const rangeA1 = normalizeA1Range(options.rangeA1);

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`
  );
  url.searchParams.set("majorDimension", "ROWS");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets API error (${res.status}): ${body.slice(0, 500)}`);
  }

  return (await res.json()) as SheetValuesResponse;
}

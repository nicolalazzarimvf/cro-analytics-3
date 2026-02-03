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
  retries?: number;
  timeoutMs?: number;
}) {
  const { accessToken, spreadsheetId, retries = 1, timeoutMs = 20000 } = options;
  const rangeA1 = normalizeA1Range(options.rangeA1);

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`
  );
  url.searchParams.set("majorDimension", "ROWS");

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: wait 1s, 2s
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          const error = new Error(`Google Sheets API error (${res.status}): ${body.slice(0, 500)}`);
          
          // Retry on 500/503 errors, but not on auth errors (401, 403) or not found (404)
          if ((res.status === 500 || res.status === 503) && attempt < retries) {
            lastError = error;
            console.warn(`[Sheets API] Attempt ${attempt + 1} failed, retrying...`, error.message);
            continue;
          }
          
          throw error;
        }

        return (await res.json()) as SheetValuesResponse;
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Don't retry on timeout/abort - these are likely infrastructure issues
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
        if (attempt < retries) {
          console.warn(`[Sheets API] Request aborted/timed out on attempt ${attempt + 1}, retrying...`);
          continue;
        }
        throw new Error(`Google Sheets API timed out after ${attempt + 1} attempts (${timeoutMs}ms per attempt)`);
      }
      
      // Retry on network errors (but not auth errors)
      if (attempt < retries && err instanceof Error && !err.message.includes('401') && !err.message.includes('403')) {
        console.warn(`[Sheets API] Attempt ${attempt + 1} failed, retrying...`, err.message);
        continue;
      }
      
      throw lastError;
    }
  }
  
  throw lastError || new Error('Google Sheets API failed after retries');
}

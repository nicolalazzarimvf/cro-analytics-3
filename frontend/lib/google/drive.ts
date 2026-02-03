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
  retries?: number;
}) {
  const { accessToken, spreadsheetId, retries = 2 } = options;

  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/export`
  );
  url.searchParams.set("mimeType", "text/csv");

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: wait 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const error = new Error(`Google Drive export error (${res.status}): ${body.slice(0, 500)}`);
        
        // Retry on 500/503 errors, but not on auth errors
        if ((res.status === 500 || res.status === 503) && attempt < retries) {
          lastError = error;
          console.warn(`[Drive export] Attempt ${attempt + 1} failed, retrying...`, error.message);
          continue;
        }
        
        throw error;
      }

      return await res.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Don't retry on timeout or abort errors
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new Error(`Google Drive export timed out after ${attempt + 1} attempts`);
      }
      
      // Retry on network errors
      if (attempt < retries && err instanceof Error && !err.message.includes('export error')) {
        console.warn(`[Drive export] Attempt ${attempt + 1} failed, retrying...`, err.message);
        continue;
      }
      
      throw lastError;
    }
  }
  
  throw lastError || new Error('Google Drive export failed after retries');
}

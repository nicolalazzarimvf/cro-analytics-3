"use client";

import { useEffect, useState } from "react";

type FileItem = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  thumbnailLink: string;
};

export function ScreenshotList({
  experimentId,
  fallback
}: {
  experimentId: string;
  fallback?: {
    webUrl: string | null;
    driveFileId: string | null;
    thumbnailUrl: string | null;
  };
}) {
  const [data, setData] = useState<FileItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/experiments/${encodeURIComponent(experimentId)}/screenshots`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json.files ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load screenshots");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  if (loading) {
    return <div className="text-sm text-gray-600">Loading screenshots…</div>;
  }

  if (data && data.length) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {data.map((file) => (
          <div key={file.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{file.name || "Untitled"}</div>
                <div className="text-xs text-gray-500">{file.mimeType}</div>
              </div>
              {file.webViewLink ? (
                <a
                  href={file.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Open
                </a>
              ) : null}
            </div>
            {file.thumbnailLink ? (
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                <img
                  src={`/api/experiments/${encodeURIComponent(
                    experimentId
                  )}/screenshots/${encodeURIComponent(file.id)}`}
                  alt={file.name || "Screenshot"}
                  className="h-auto w-full"
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-gray-700">
        Could not load Drive screenshots ({error}).{" "}
        {fallback?.webUrl ? (
          <a
            href={fallback.webUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand-700 hover:underline"
          >
            Open stored link
          </a>
        ) : (
          "No stored link available."
        )}
      </div>
    );
  }

  return (
    <div className="text-sm text-gray-600">
      No Drive screenshots found for this experiment id.{" "}
      {fallback?.webUrl ? (
        <a
          href={fallback.webUrl}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Open stored link
        </a>
      ) : (
        "No stored link available."
      )}
    </div>
  );
}

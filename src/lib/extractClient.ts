// ---------------------------------------------------------------------------
// Client helper: send an image to the server's /api/extract (Claude Vision).
// Runs in the browser; the API key never leaves the server.
// ---------------------------------------------------------------------------

import type { ActualHolding, ModelHolding } from "./types";

/** Read a File/Blob into a base64 string (no data: prefix). */
export function fileToBase64(file: Blob): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      const mediaType = (result.match(/^data:([^;]+);/)?.[1]) || file.type || "image/png";
      resolve({ base64, mediaType });
    };
    reader.readAsDataURL(file);
  });
}

/** Extract model holdings from an image via Claude Vision. */
export async function extractModel(file: Blob): Promise<ModelHolding[]> {
  return extract(file, "model") as Promise<ModelHolding[]>;
}

/** Extract current holdings from an image via Claude Vision. */
export async function extractActual(file: Blob): Promise<ActualHolding[]> {
  return extract(file, "actual") as Promise<ActualHolding[]>;
}

async function extract(file: Blob, kind: "model" | "actual") {
  const { base64, mediaType } = await fileToBase64(file);
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: base64, mediaType, kind }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Extract failed (${res.status})`);
  return data.holdings;
}

// ---------------------------------------------------------------------------
// OPTIONAL AI Vision extraction (server-side only), multi-provider.
//
// Off by default. When a vision API key is set, the UI offers an "AI Vision"
// toggle that extracts holdings from a screenshot far more accurately than
// local OCR. Two providers are supported and auto-selected by whichever key is
// present (Gemini preferred, since it has a free tier):
//
//   GEMINI_API_KEY     -> Google Gemini   (default; free tier available)
//   ANTHROPIC_API_KEY  -> Anthropic Claude
//
// Set VISION_PROVIDER=gemini|claude to force one when both keys exist.
// Calls the provider's REST API directly via fetch (no SDK dependency), asks
// for strict JSON, then reconciles through the same symbol resolver used
// everywhere else. Keys stay server-side and never reach the browser.
// ---------------------------------------------------------------------------

import { resolveSymbol, type SymbolAlias } from "./symbols";
import type { ActualHolding, ModelHolding } from "./types";

export type ExtractKind = "model" | "actual";
export type VisionProvider = "gemini" | "claude";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Rolling alias that always resolves to the current Flash model, so we don't
// break when a pinned version is retired. Override with GEMINI_MODEL.
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/** Which provider will be used, based on env. Null when none configured. */
export function getVisionProvider(): VisionProvider | null {
  const forced = process.env.VISION_PROVIDER?.toLowerCase();
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export function isVisionAvailable(): boolean {
  return getVisionProvider() !== null;
}

const MODEL_PROMPT = `This image shows a MODEL investment portfolio: a list of companies (by name and/or ticker) each with a target percentage weight, usually including a "Cash" line.
Extract EVERY line item. Respond with ONLY a JSON array (no prose, no code fences), where each element is:
{"label": "<company name or ticker exactly as shown>", "percent": <number>}
Include the Cash line as {"label": "Cash", "percent": <number>}.`;

const ACTUAL_PROMPT = `This image is a stock brokerage "Portfolio Holdings" table for the Pakistan Stock Exchange (PSX).
Extract EVERY row. Respond with ONLY a JSON array (no prose, no code fences), where each element is:
{"symbol": "<ticker exactly as shown>", "quantity": <number>, "price": <current price number>, "marketValue": <number>}
Rules:
- Use the "Curr. Price" column for price and the "Market Value" column for marketValue.
- Convert abbreviated numbers: "1.11M" -> 1110000, "919.88K" -> 919880, "11,250" -> 11250. No commas or letters in the output numbers.
- For the CASH row, output {"symbol":"CASH","quantity":0,"price":1,"marketValue":<the cash amount>}.`;

function promptFor(kind: ExtractKind): string {
  return kind === "model" ? MODEL_PROMPT : ACTUAL_PROMPT;
}

// ---- Response text extraction (pure, testable) ----------------------------

export function extractClaudeText(data: unknown): string {
  const d = data as { content?: Array<{ type: string; text?: string }> };
  return (d.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");
}

export function extractGeminiText(data: unknown): string {
  const d = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/**
 * Extract a JSON array from a model response. Tolerant of code fences, leading
 * prose, and an object that wraps the array under some key (e.g. {"rows":[…]}).
 */
export function extractJsonArray(text: string): unknown[] {
  const trimmed = (text ?? "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : trimmed).trim();

  // 1) Direct array slice.
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const p = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(p)) return p;
    } catch {
      /* fall through */
    }
  }

  // 2) Whole thing is JSON: an array, or an object wrapping one.
  try {
    const obj = JSON.parse(candidate);
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) if (Array.isArray(v)) return v;
    }
  } catch {
    /* fall through */
  }

  throw new Error("Vision response did not contain a JSON array.");
}

/** Gemini responseSchema forcing an array of the shape we want. */
function geminiSchema(kind: ExtractKind) {
  if (kind === "model") {
    return {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, percent: { type: "NUMBER" } },
        required: ["label", "percent"],
      },
    };
  }
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        symbol: { type: "STRING" },
        quantity: { type: "NUMBER" },
        price: { type: "NUMBER" },
        marketValue: { type: "NUMBER" },
      },
      required: ["symbol"],
    },
  };
}

/** Map raw vision JSON into typed holdings, resolving symbols via aliases. */
export function mapVisionRows(
  rows: unknown[],
  kind: ExtractKind,
  aliases: SymbolAlias[]
): ModelHolding[] | ActualHolding[] {
  if (kind === "model") {
    return rows
      .map((r) => r as { label?: string; percent?: number })
      .filter((r) => r.label && typeof r.percent === "number")
      .map((r) => ({
        symbol: resolveSymbol(String(r.label), aliases),
        name: String(r.label),
        targetPct: Number(r.percent),
      })) satisfies ModelHolding[];
  }
  return rows
    .map((r) => r as { symbol?: string; quantity?: number; price?: number; marketValue?: number })
    .filter((r) => r.symbol)
    .map((r) => {
      const symbol = resolveSymbol(String(r.symbol), aliases);
      const isCash = symbol === "CASH";
      return {
        symbol,
        name: String(r.symbol),
        quantity: isCash ? 0 : Number(r.quantity ?? 0),
        price: isCash ? 1 : Number(r.price ?? 0),
        value:
          typeof r.marketValue === "number" && !Number.isNaN(r.marketValue)
            ? Number(r.marketValue)
            : undefined,
      } as ActualHolding;
    }) satisfies ActualHolding[];
}

// ---- Provider calls -------------------------------------------------------

interface GeminiModelInfo {
  name: string;
  supportedGenerationMethods?: string[];
}

/**
 * Pick a vision-capable Gemini model from a ListModels result. Prefers a
 * "-latest" flash alias, then a plain flash, then flash-lite, then any model
 * that supports generateContent. Excludes non-text generators (image/tts/
 * embedding). Pure + exported for testing.
 */
export function chooseGeminiModel(models: GeminiModelInfo[]): string | null {
  const usable = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => !/(image|imagen|tts|embedding|aqa|learnlm)/i.test(n));
  const score = (n: string) => {
    if (/flash-latest/.test(n)) return 5;
    if (/flash(?!-lite)/.test(n) && /latest/.test(n)) return 4;
    if (/flash(?!-lite)/.test(n)) return 3;
    if (/flash-lite/.test(n)) return 2;
    if (/pro/.test(n)) return 1;
    return 0;
  };
  const sorted = usable.sort((a, b) => score(b) - score(a));
  return sorted[0] ?? null;
}

async function listGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const res = await fetch(`${GEMINI_BASE}?pageSize=100`, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: GeminiModelInfo[] };
  return data.models ?? [];
}

async function geminiGenerate(model: string, apiKey: string, base64: string, mediaType: string, kind: ExtractKind) {
  return fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: promptFor(kind) },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        // Generous budget: newer Flash models are "thinking" models that spend
        // tokens reasoning before emitting the answer; too small a budget yields
        // empty text (finishReason MAX_TOKENS).
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: geminiSchema(kind),
      },
    }),
  });
}

/** finishReason of the first candidate, for diagnostics. */
function geminiFinishReason(data: unknown): string {
  const d = data as { candidates?: Array<{ finishReason?: string }> };
  return d.candidates?.[0]?.finishReason ?? "unknown";
}

async function callGemini(base64: string, mediaType: string, kind: ExtractKind): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!;
  let model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  let res = await geminiGenerate(model, apiKey, base64, mediaType, kind);
  let body = res.ok ? "" : await res.text().catch(() => "");

  // Self-heal: if the configured model is missing/retired/unsupported for this
  // key, discover a supported one from the account and retry once.
  const badModel =
    !res.ok &&
    (res.status === 404 || (res.status === 400 && /not found|not available|not supported|unsupported/i.test(body)));
  if (badModel) {
    const alt = chooseGeminiModel(await listGeminiModels(apiKey));
    if (alt && alt !== model) {
      model = alt;
      res = await geminiGenerate(model, apiKey, base64, mediaType, kind);
      body = res.ok ? "" : await res.text().catch(() => "");
    }
  }

  if (!res.ok) {
    const authFailed =
      res.status === 401 || res.status === 403 || (res.status === 400 && /api key|api_key|permission/i.test(body));
    const hint = authFailed
      ? " — your GEMINI_API_KEY was rejected. Get a key at https://aistudio.google.com/apikey (it should start with 'AIza')."
      : res.status === 404
      ? " — no vision model available for this key. Set GEMINI_MODEL to one your key can access."
      : "";
    throw new Error(`Gemini API error ${res.status} (model ${model})${hint}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = extractGeminiText(data);
  if (!text.trim()) {
    const reason = geminiFinishReason(data);
    throw new Error(
      `Gemini returned no text (finishReason=${reason}, model ${model}). ` +
        (reason === "MAX_TOKENS"
          ? "The model ran out of output budget — retry, or use OCR/CSV."
          : reason === "SAFETY"
          ? "The response was blocked by a safety filter — try OCR/CSV."
          : "Try again, or use OCR/CSV.")
    );
  }
  return text;
}

async function callClaude(base64: string, mediaType: string, kind: ExtractKind): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: promptFor(kind) },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return extractClaudeText(await res.json());
}

/**
 * Call the configured vision provider and return typed holdings. Throws with a
 * clear message on missing key or API error so the UI can fall back to OCR.
 */
export async function extractWithVision(
  base64: string,
  mediaType: string,
  kind: ExtractKind,
  aliases: SymbolAlias[]
): Promise<ModelHolding[] | ActualHolding[]> {
  const provider = getVisionProvider();
  if (!provider) throw new Error("No vision API key set (GEMINI_API_KEY or ANTHROPIC_API_KEY).");
  const text = provider === "gemini" ? await callGemini(base64, mediaType, kind) : await callClaude(base64, mediaType, kind);
  const rows = extractJsonArray(text);
  return mapVisionRows(rows, kind, aliases);
}

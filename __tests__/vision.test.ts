import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractJsonArray,
  mapVisionRows,
  extractGeminiText,
  extractClaudeText,
  chooseGeminiModel,
  extractWithVision,
} from "@/lib/vision";
import { SEED_ALIASES } from "@/lib/symbols";
import type { ActualHolding, ModelHolding } from "@/lib/types";

describe("provider text extraction", () => {
  it("reads text parts from a Gemini response", () => {
    const data = { candidates: [{ content: { parts: [{ text: '[{"label":"Cash","percent":10}]' }] } }] };
    expect(extractGeminiText(data)).toContain("Cash");
  });
  it("reads text blocks from a Claude response", () => {
    const data = { content: [{ type: "text", text: "[1,2]" }, { type: "thinking", text: "x" }] };
    expect(extractClaudeText(data)).toBe("[1,2]");
  });
});

describe("chooseGeminiModel", () => {
  const gen = (n: string) => ({ name: n, supportedGenerationMethods: ["generateContent"] });
  it("prefers a flash-latest alias", () => {
    const chosen = chooseGeminiModel([
      gen("models/gemini-2.5-pro"),
      gen("models/gemini-flash-latest"),
      gen("models/gemini-2.0-flash"),
    ]);
    expect(chosen).toBe("gemini-flash-latest");
  });
  it("falls back to a plain flash, then lite, then pro", () => {
    expect(chooseGeminiModel([gen("models/gemini-3.0-flash"), gen("models/gemini-3.0-pro")])).toBe("gemini-3.0-flash");
    expect(chooseGeminiModel([gen("models/gemini-x-flash-lite"), gen("models/gemini-x-pro")])).toBe("gemini-x-flash-lite");
  });
  it("excludes non-text and models without generateContent", () => {
    const chosen = chooseGeminiModel([
      { name: "models/gemini-2.5-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      gen("models/gemini-flash-latest"),
    ]);
    expect(chosen).toBe("gemini-flash-latest");
  });
  it("returns null when nothing is usable", () => {
    expect(chooseGeminiModel([{ name: "models/embed", supportedGenerationMethods: ["embedContent"] }])).toBeNull();
  });
});

describe("extractWithVision (Gemini self-heal)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.VISION_PROVIDER;
  });

  it("retries with a discovered model when the pinned model 404s", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-2.5-flash"; // retired -> 404

    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes(":generateContent") && url.includes("gemini-2.5-flash")) {
        return new Response(JSON.stringify({ error: { code: 404, message: "no longer available" } }), { status: 404 });
      }
      if (url.endsWith("/models") || url.includes("/models?")) {
        return new Response(
          JSON.stringify({
            models: [
              { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
              { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes(":generateContent") && url.includes("gemini-flash-latest")) {
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: '[{"symbol":"FABL","quantity":10,"price":100,"marketValue":1000}]' }] } },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const holdings = (await extractWithVision("BASE64", "image/png", "actual", SEED_ALIASES)) as ActualHolding[];
    expect(holdings.find((h) => h.symbol === "FABL")?.quantity).toBe(10);
    // proves it hit the retired model, listed models, then retried the discovered one
    expect(calls.some((u) => u.includes("gemini-2.5-flash"))).toBe(true);
    expect(calls.some((u) => u.includes("/models"))).toBe(true);
    expect(calls.some((u) => u.includes("gemini-flash-latest:generateContent"))).toBe(true);
  });

  it("surfaces an auth-failure hint when the key is rejected", async () => {
    process.env.GEMINI_API_KEY = "bad-key";
    process.env.GEMINI_MODEL = "gemini-flash-latest";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }))
    );
    await expect(extractWithVision("B64", "image/png", "model", SEED_ALIASES)).rejects.toThrow(/rejected|AIza/);
  });
});

describe("extractJsonArray", () => {
  it("parses a bare JSON array", () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it("parses a fenced JSON array with prose around it", () => {
    const text = "Here you go:\n```json\n[{\"label\":\"Cash\",\"percent\":10}]\n```\nDone.";
    expect(extractJsonArray(text)).toEqual([{ label: "Cash", percent: 10 }]);
  });
  it("unwraps an array nested inside an object", () => {
    expect(extractJsonArray('{"rows":[{"symbol":"FABL"}]}')).toEqual([{ symbol: "FABL" }]);
  });
  it("throws when there is no array", () => {
    expect(() => extractJsonArray("no json here")).toThrow();
  });
});

describe("mapVisionRows", () => {
  it("maps model rows and resolves symbols", () => {
    const rows = [
      { label: "Faysal Bank Limited", percent: 11 },
      { label: "Cash", percent: 10 },
    ];
    const out = mapVisionRows(rows, "model", SEED_ALIASES) as ModelHolding[];
    expect(out.find((r) => r.symbol === "FABL")?.targetPct).toBe(11);
    expect(out.find((r) => r.symbol === "CASH")?.targetPct).toBe(10);
  });

  it("maps actual rows incl. CASH", () => {
    const rows = [
      { symbol: "FABL", quantity: 11250, price: 98.68, marketValue: 1110000 },
      { symbol: "CASH", quantity: 0, price: 1, marketValue: 1110000 },
    ];
    const out = mapVisionRows(rows, "actual", SEED_ALIASES) as ActualHolding[];
    const fabl = out.find((r) => r.symbol === "FABL")!;
    expect(fabl.quantity).toBe(11250);
    expect(fabl.value).toBe(1110000);
    const cash = out.find((r) => r.symbol === "CASH")!;
    expect(cash.price).toBe(1);
    expect(cash.value).toBe(1110000);
  });
});

import { NextResponse } from "next/server";
import { extractWithVision, isVisionAvailable, type ExtractKind } from "@/lib/vision";
import { getAliases } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExtractRequest {
  imageBase64: string;
  mediaType?: string;
  kind: ExtractKind;
}

/**
 * POST /api/extract  -> extract holdings from an image using Claude Vision.
 * Requires ANTHROPIC_API_KEY on the server. Returns { holdings } or { error }.
 */
export async function POST(req: Request) {
  try {
    if (!isVisionAvailable()) {
      return NextResponse.json(
        { error: "Claude Vision is not configured. Set ANTHROPIC_API_KEY to enable it." },
        { status: 400 }
      );
    }
    const body = (await req.json()) as ExtractRequest;
    if (!body.imageBase64 || !body.kind) {
      return NextResponse.json({ error: "imageBase64 and kind are required." }, { status: 400 });
    }
    const aliases = await getAliases();
    const holdings = await extractWithVision(
      body.imageBase64,
      body.mediaType || "image/png",
      body.kind,
      aliases
    );
    return NextResponse.json({ holdings });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

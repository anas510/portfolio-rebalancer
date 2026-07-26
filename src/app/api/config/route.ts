import { NextResponse } from "next/server";
import { getVisionProvider, isVisionAvailable } from "@/lib/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config -> feature flags the client needs (never leaks secrets). */
export async function GET() {
  return NextResponse.json({
    visionAvailable: isVisionAvailable(),
    visionProvider: getVisionProvider(), // "gemini" | "claude" | null
    livePricesEnabled: process.env.ENABLE_LIVE_PSX_PRICES !== "false",
  });
}

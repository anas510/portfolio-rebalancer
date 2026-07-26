import { NextResponse } from "next/server";
import { fetchLivePrices } from "@/lib/psx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/prices?symbols=FABL,TGL -> best-effort live PSX prices. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbols = (searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const prices = await fetchLivePrices(symbols);
    return NextResponse.json({
      prices: Object.fromEntries(prices),
      enabled: process.env.ENABLE_LIVE_PSX_PRICES !== "false",
      count: prices.size,
    });
  } catch (err) {
    return NextResponse.json(
      { prices: {}, error: String(err) },
      { status: 200 },
    );
  }
}

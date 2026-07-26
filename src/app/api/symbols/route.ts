import { NextResponse } from "next/server";
import { addAlias, deleteAlias, getAliases } from "@/lib/repo";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/symbols -> all symbol aliases (ticker <-> company name). */
export async function GET() {
  try {
    await requireUser();
    const aliases = await getAliases();
    return NextResponse.json({ aliases });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /api/symbols  { symbol, name } -> add a mapping. */
export async function POST(req: Request) {
  try {
    await requireUser();
    const { symbol, name } = (await req.json()) as { symbol?: string; name?: string };
    if (!symbol || !name) {
      return NextResponse.json({ error: "symbol and name are required." }, { status: 400 });
    }
    await addAlias(symbol, name);
    return NextResponse.json({ aliases: await getAliases() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE /api/symbols  { symbol, name } -> remove a mapping. */
export async function DELETE(req: Request) {
  try {
    await requireUser();
    const { symbol, name } = (await req.json()) as { symbol?: string; name?: string };
    if (!symbol || !name) {
      return NextResponse.json({ error: "symbol and name are required." }, { status: 400 });
    }
    await deleteAlias(symbol, name);
    return NextResponse.json({ aliases: await getAliases() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

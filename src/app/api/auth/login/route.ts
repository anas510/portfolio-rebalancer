import { NextResponse } from "next/server";
import { AuthError, authenticateUser, setSessionCookie, validateEmail } from "@/lib/auth";
import { ensurePortfolio } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/login { email, password } */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = body.email ?? "";
    const password = body.password ?? "";

    const emailErr = validateEmail(email);
    if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 });
    if (!password) return NextResponse.json({ error: "Password is required." }, { status: 400 });

    const user = await authenticateUser(email, password);
    await ensurePortfolio(user.id);
    await setSessionCookie(user);

    return NextResponse.json({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

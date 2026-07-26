import { NextResponse } from "next/server";
import { AuthError, requireUser, updateUserPassword, validatePassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/password { currentPassword, newPassword } */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { currentPassword?: string; newPassword?: string };
    const currentPassword = body.currentPassword ?? "";
    const newPassword = body.newPassword ?? "";

    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required." }, { status: 400 });
    }

    const pwdErr = validatePassword(newPassword);
    if (pwdErr) return NextResponse.json({ error: pwdErr }, { status: 400 });

    await updateUserPassword(user.id, currentPassword, newPassword);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

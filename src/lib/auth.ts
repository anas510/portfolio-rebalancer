import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";

export const SESSION_COOKIE = "pr_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  email: string;
  isAdmin: boolean;
}

type Row = Record<string, unknown>;

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, isAdmin: user.isAdmin })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getAuthSecret());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    const id = Number(payload.sub);
    if (!id || !payload.email) return null;
    return {
      id,
      email: String(payload.email),
      isAdmin: Boolean(payload.isAdmin),
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60));
}

export async function clearSessionCookie(): Promise<void> {
  cookies().set(SESSION_COOKIE, "", sessionCookieOptions(0));
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Unauthorized", 401);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthError("Forbidden", 403);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email address.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

// ---- User persistence -------------------------------------------------------

export async function findUserByEmail(email: string): Promise<{ id: number; email: string; passwordHash: string; isAdmin: boolean } | null> {
  const client = await db();
  const res = await client.execute({
    sql: "SELECT id, email, password_hash, is_admin FROM user WHERE email = ?",
    args: [email.trim().toLowerCase()],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as Row;
  return {
    id: Number(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    isAdmin: Number(row.is_admin) === 1,
  };
}

export async function createUser(email: string, password: string, isAdmin = false): Promise<SessionUser> {
  const normalized = email.trim().toLowerCase();
  const existing = await findUserByEmail(normalized);
  if (existing) throw new AuthError("An account with this email already exists.", 409);

  const passwordHash = await hashPassword(password);
  const client = await db();
  const res = await client.execute({
    sql: "INSERT INTO user (email, password_hash, is_admin) VALUES (?, ?, ?)",
    args: [normalized, passwordHash, isAdmin ? 1 : 0],
  });
  return { id: Number(res.lastInsertRowid), email: normalized, isAdmin };
}

export async function authenticateUser(email: string, password: string): Promise<SessionUser> {
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError("Invalid email or password.", 401);
  }
  return { id: user.id, email: user.email, isAdmin: user.isAdmin };
}

export interface AdminUserRow {
  id: number;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  portfolioCount: number;
}

export async function getAdminStats(): Promise<{ totalUsers: number; users: AdminUserRow[] }> {
  const client = await db();
  const res = await client.execute(`
    SELECT u.id, u.email, u.is_admin, u.created_at,
           (SELECT COUNT(*) FROM portfolio p WHERE p.user_id = u.id) AS portfolio_count
    FROM user u
    ORDER BY u.created_at DESC
  `);
  const users = res.rows.map((r) => {
    const row = r as Row;
    return {
      id: Number(row.id),
      email: String(row.email),
      isAdmin: Number(row.is_admin) === 1,
      createdAt: String(row.created_at),
      portfolioCount: Number(row.portfolio_count ?? 0),
    };
  });
  return { totalUsers: users.length, users };
}

import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { getSessionUser, setSessionCookie, clearSessionCookie, type SessionUser } from "./session";

export { setSessionCookie, clearSessionCookie, getSessionUser, type SessionUser } from "./session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Unauthorized", 401);

  const row = await getUserById(user.id);
  if (!row) throw new AuthError("Unauthorized", 401);
  if (row.isBlocked) throw new AuthError("This account has been blocked.", 403);

  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthError("Forbidden", 403);
  return user;
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

type Row = Record<string, unknown>;

export async function findUserByEmail(
  email: string
): Promise<{ id: number; email: string; passwordHash: string; isAdmin: boolean; isBlocked: boolean } | null> {
  const client = await db();
  const res = await client.execute({
    sql: "SELECT id, email, password_hash, is_admin, is_blocked FROM user WHERE email = ?",
    args: [email.trim().toLowerCase()],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as Row;
  return {
    id: Number(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    isAdmin: Number(row.is_admin) === 1,
    isBlocked: Number(row.is_blocked ?? 0) === 1,
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
  if (user.isBlocked) {
    throw new AuthError("This account has been blocked. Contact support.", 403);
  }
  return { id: user.id, email: user.email, isAdmin: user.isAdmin };
}

export interface AdminUserRow {
  id: number;
  email: string;
  isAdmin: boolean;
  isBlocked: boolean;
  createdAt: string;
  portfolioCount: number;
}

export async function getAdminStats(): Promise<{ totalUsers: number; users: AdminUserRow[] }> {
  const client = await db();
  const res = await client.execute(`
    SELECT u.id, u.email, u.is_admin, u.is_blocked, u.created_at,
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
      isBlocked: Number(row.is_blocked ?? 0) === 1,
      createdAt: String(row.created_at),
      portfolioCount: Number(row.portfolio_count ?? 0),
    };
  });
  return { totalUsers: users.length, users };
}

async function getUserById(id: number): Promise<{ id: number; email: string; isAdmin: boolean; isBlocked: boolean } | null> {
  const client = await db();
  const res = await client.execute({
    sql: "SELECT id, email, is_admin, is_blocked FROM user WHERE id = ?",
    args: [id],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0] as Row;
  return {
    id: Number(row.id),
    email: String(row.email),
    isAdmin: Number(row.is_admin) === 1,
    isBlocked: Number(row.is_blocked ?? 0) === 1,
  };
}

async function countAdmins(): Promise<number> {
  const client = await db();
  const res = await client.execute("SELECT COUNT(*) AS c FROM user WHERE is_admin = 1");
  return Number((res.rows[0] as Row).c ?? 0);
}

function assertCanModifyUser(actor: SessionUser, target: { id: number; isAdmin: boolean }, action: string): void {
  if (target.id === actor.id) {
    throw new AuthError(`You cannot ${action} your own account.`, 400);
  }
}

export async function setUserBlocked(actor: SessionUser, userId: number, blocked: boolean): Promise<void> {
  const target = await getUserById(userId);
  if (!target) throw new AuthError("User not found.", 404);
  assertCanModifyUser(actor, target, blocked ? "block" : "unblock");

  const client = await db();
  await client.execute({
    sql: "UPDATE user SET is_blocked = ? WHERE id = ?",
    args: [blocked ? 1 : 0, userId],
  });
}

export async function deleteUser(actor: SessionUser, userId: number): Promise<void> {
  const target = await getUserById(userId);
  if (!target) throw new AuthError("User not found.", 404);
  assertCanModifyUser(actor, target, "delete");

  if (target.isAdmin && (await countAdmins()) <= 1) {
    throw new AuthError("Cannot delete the last admin account.", 400);
  }

  const client = await db();

  await client.execute({
    sql: "DELETE FROM portfolio_holding WHERE portfolio_id IN (SELECT id FROM portfolio WHERE user_id = ?)",
    args: [userId],
  });
  await client.execute({ sql: "DELETE FROM portfolio WHERE user_id = ?", args: [userId] });
  await client.execute({
    sql: "DELETE FROM model_holding WHERE model_id IN (SELECT id FROM model_portfolio WHERE user_id = ?)",
    args: [userId],
  });
  await client.execute({ sql: "DELETE FROM model_portfolio WHERE user_id = ?", args: [userId] });
  await client.execute({ sql: "DELETE FROM rebalance_run WHERE user_id = ?", args: [userId] });
  await client.execute({ sql: "DELETE FROM user WHERE id = ?", args: [userId] });
}

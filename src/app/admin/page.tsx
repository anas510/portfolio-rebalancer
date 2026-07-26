"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: number;
  email: string;
  isAdmin: boolean;
  isBlocked: boolean;
  createdAt: string;
  portfolioCount: number;
}

interface AdminStats {
  totalUsers: number;
  users: AdminUser[];
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<number | null>(null);

  const loadStats = useCallback(async () => {
    const r = await fetch("/api/admin/stats");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Failed to load stats.");
    setStats(data);
  }, []);

  useEffect(() => {
    loadStats()
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [loadStats]);

  async function runAction(userId: number, action: "block" | "unblock" | "delete", email: string) {
    const labels = { block: "block", unblock: "unblock", delete: "permanently delete" };
    const extra = action === "delete" ? " All of their portfolios and saved data will be removed." : "";
    if (!window.confirm(`${labels[action].charAt(0).toUpperCase() + labels[action].slice(1)} ${email}?${extra}`)) {
      return;
    }

    setActingOn(userId);
    setError(null);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Action failed.");
      setStats(data);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setActingOn(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="section-title" style={{ fontSize: "1.6rem", marginTop: 6 }}>
          Admin panel
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--ink-soft)", maxWidth: "36rem" }}>
          Manage registered users. Blocked users cannot sign in; deleted users and their portfolios are removed permanently.
        </p>
      </div>

      {loading && <p style={{ color: "var(--ink-soft)" }}>Loading…</p>}
      {error && (
        <p style={{ color: "var(--red)", background: "var(--red-tint)", padding: "12px 14px", borderRadius: 10 }}>
          {error}
        </p>
      )}

      {stats && (
        <>
          <div className="card" style={{ maxWidth: 320 }}>
            <p className="eyebrow">Registered users</p>
            <p className="section-title mono" style={{ fontSize: "2.25rem", marginTop: 8 }}>
              {stats.totalUsers}
            </p>
          </div>

          <div className="card overflow-x-auto">
            <h2 className="section-title" style={{ fontSize: "1.1rem", marginBottom: 16 }}>
              All users
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Portfolios</th>
                  <th>Registered</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.isAdmin ? "Admin" : "User"}</td>
                    <td>{u.isBlocked ? "Blocked" : "Active"}</td>
                    <td className="mono">{u.portfolioCount}</td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      {new Date(u.createdAt + "Z").toLocaleString()}
                    </td>
                    <td>
                      <div className="toolbar" style={{ gap: 6 }}>
                        {u.isBlocked ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ padding: "0.35rem 0.65rem", fontSize: 12 }}
                            disabled={actingOn === u.id}
                            onClick={() => runAction(u.id, "unblock", u.email)}
                          >
                            Unblock
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ padding: "0.35rem 0.65rem", fontSize: 12 }}
                            disabled={actingOn === u.id}
                            onClick={() => runAction(u.id, "block", u.email)}
                          >
                            Block
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{
                            padding: "0.35rem 0.65rem",
                            fontSize: 12,
                            color: "var(--red)",
                            borderColor: "var(--red-tint)",
                          }}
                          disabled={actingOn === u.id}
                          onClick={() => runAction(u.id, "delete", u.email)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p>
        <Link href="/" className="btn-ghost">
          ← Back to rebalancer
        </Link>
      </p>
    </div>
  );
}

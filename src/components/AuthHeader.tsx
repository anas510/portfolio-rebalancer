"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface UserInfo {
  email: string;
  isAdmin: boolean;
}

export default function AuthHeader() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!user) return null;

  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{user.email}</span>
      {user.isAdmin && (
        <Link href="/admin" className="btn-ghost" style={{ padding: "0.4rem 0.75rem", fontSize: 12 }}>
          Admin
        </Link>
      )}
      <button type="button" className="btn-ghost" style={{ padding: "0.4rem 0.75rem", fontSize: 12 }} onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

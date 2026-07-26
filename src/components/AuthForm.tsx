"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

interface AuthFormProps {
  mode: "login" | "register";
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const title = mode === "login" ? "Sign in" : "Create account";
  const subtitle =
    mode === "login"
      ? "Sign in to manage your portfolios."
      : "Register to save and manage your own portfolios.";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="card">
        <p className="eyebrow">{mode === "login" ? "Welcome back" : "Get started"}</p>
        <h1 className="section-title" style={{ fontSize: "1.5rem", marginTop: 6 }}>
          {title}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--ink-soft)" }}>{subtitle}</p>

        <form onSubmit={onSubmit} className="space-y-4" style={{ marginTop: 24 }}>
          <label htmlFor="email" className="field">
            <span>Email</span>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label htmlFor="password" className="field">
            <span>Password</span>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {mode === "register" && (
            <label htmlFor="confirm" className="field">
              <span>Confirm password</span>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          )}

          {error && (
            <p style={{ fontSize: 13, color: "var(--red)", background: "var(--red-tint)", padding: "10px 12px", borderRadius: 10 }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? "Please wait…" : title}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 13, color: "var(--ink-soft)", textAlign: "center" }}>
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link href="/register" style={{ color: "var(--green-strong)", fontWeight: 600 }}>
                Register
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" style={{ color: "var(--green-strong)", fontWeight: 600 }}>
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

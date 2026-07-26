"use client";

import { FormEvent, useState } from "react";

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label htmlFor="current-password" className="field">
        <span>Current password</span>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </label>

      <label htmlFor="new-password" className="field">
        <span>New password</span>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>

      <label htmlFor="confirm-password" className="field">
        <span>Confirm new password</span>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>

      {error && (
        <p
          style={{
            fontSize: 13,
            color: "var(--red)",
            background: "var(--red-tint)",
            padding: "10px 12px",
            borderRadius: 10,
          }}
        >
          {error}
        </p>
      )}

      {success && (
        <p
          style={{
            fontSize: 13,
            color: "var(--green-strong)",
            background: "var(--green-tint)",
            padding: "10px 12px",
            borderRadius: 10,
          }}
        >
          Password updated successfully.
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

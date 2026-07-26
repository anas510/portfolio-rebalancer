import ChangePasswordForm from "@/components/ChangePasswordForm";

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="card">
        <p className="eyebrow">Account</p>
        <h1 className="section-title" style={{ fontSize: "1.5rem", marginTop: 6 }}>
          Change password
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--ink-soft)" }}>
          Enter your current password and choose a new one.
        </p>

        <div style={{ marginTop: 24 }}>
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}

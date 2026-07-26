import type { Metadata } from "next";
import "./globals.css";
import AuthHeader from "@/components/AuthHeader";

export const metadata: Metadata = {
  title: "PSX Portfolio Rebalancer",
  description:
    "Rebalance your PSX portfolio against a saved model portfolio using screenshots, CSV, or manual entry.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "rgba(255,255,255,0.8)",
            backdropFilter: "saturate(180%) blur(12px)",
            WebkitBackdropFilter: "saturate(180%) blur(12px)",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3.5">
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "var(--green)",
                boxShadow: "0 1px 2px rgba(14,159,110,0.35)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
                <path d="M4 15l5-5 4 4 7-8" />
              </svg>
            </span>
            <div style={{ lineHeight: 1.1 }}>
              <h1 className="section-title" style={{ fontSize: "16px" }}>
                Portfolio Rebalancer
              </h1>
              <p style={{ fontSize: "12px", color: "var(--ink-soft)", marginTop: 1 }}>
                Pakistan Stock Exchange
              </p>
            </div>
            <AuthHeader />
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>

        <footer
          className="mx-auto max-w-5xl px-6 pb-14 pt-4"
          style={{ fontSize: "12px", color: "var(--ink-faint)" }}
        >
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
            Local-first · OCR runs in your browser · figures in PKR · not investment advice
          </div>
        </footer>
      </body>
    </html>
  );
}

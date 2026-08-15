"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const INPUT_CLASS =
  "rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPendingNotice(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "pending") {
          setPendingNotice(data.message || "ממתין לאישור מנהל המערכת");
        } else {
          setError(data.error || "שגיאה בהתחברות");
        }
        setLoading(false);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";
      // Full navigation (not router.push) so the proxy re-checks with the fresh cookie.
      window.location.href = next;
    } catch {
      setError("שגיאת רשת — נסו שוב.");
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border p-6"
      >
        <div className="text-center">
          <div className="mb-1 text-2xl" aria-hidden>
            🔒
          </div>
          <h1 className="text-lg font-semibold text-foreground">כניסה לצוות ה-AI שלי</h1>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-muted-foreground">
            אימייל
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
            autoFocus
            autoComplete="email"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-muted-foreground">
            סיסמה
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
            autoComplete="current-password"
          />
        </div>

        {pendingNotice && (
          <p className="text-sm rounded-lg bg-amber-500/10 text-amber-600 px-3 py-2">{pendingNotice}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading || !email || !password}>
          {loading ? "מתחבר/ת..." : "כניסה"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          אין לכם חשבון?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            הרשמה
          </Link>
        </p>
      </form>
    </div>
  );
}

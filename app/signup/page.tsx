"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const INPUT_CLASS =
  "rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "שגיאה בהרשמה");
        setLoading(false);
        return;
      }
      setSuccessMessage(data.message || "החשבון נוצר, ממתין לאישור מנהל המערכת.");
      setLoading(false);
    } catch {
      setError("שגיאת רשת — נסו שוב.");
      setLoading(false);
    }
  };

  if (successMessage) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border p-6 text-center">
          <div className="text-2xl" aria-hidden>
            ✅
          </div>
          <p className="text-sm">{successMessage}</p>
          <Link href="/login" className="text-sm text-primary hover:underline">
            חזרה למסך ההתחברות
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border p-6"
      >
        <div className="text-center">
          <div className="mb-1 text-2xl" aria-hidden>
            🆕
          </div>
          <h1 className="text-lg font-semibold text-foreground">הרשמה לצוות ה-AI</h1>
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
            autoComplete="new-password"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirm" className="text-sm text-muted-foreground">
            אימות סיסמה
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={INPUT_CLASS}
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading || !email || !password || !confirm}>
          {loading ? "נרשם/ת..." : "הרשמה"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          כבר יש לכם חשבון?{" "}
          <Link href="/login" className="text-primary hover:underline">
            כניסה
          </Link>
        </p>
      </form>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface PendingUser {
  id: string;
  email: string;
  createdAt: string;
}

export function UsersAdminClient({ initialPending }: { initialPending: PendingUser[] }) {
  const [pending, setPending] = useState(initialPending);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleDecision = async (id: string, status: "approved" | "rejected") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setPending((prev) => prev.filter((u) => u.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  if (pending.length === 0) {
    return <p className="text-sm text-muted-foreground">אין משתמשים הממתינים לאישור.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {pending.map((u) => (
        <Card key={u.id}>
          <CardContent className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium">{u.email}</div>
              <div className="text-xs text-muted-foreground">{u.createdAt}</div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === u.id}
                onClick={() => handleDecision(u.id, "rejected")}
              >
                דחייה
              </Button>
              <Button size="sm" disabled={busyId === u.id} onClick={() => handleDecision(u.id, "approved")}>
                אישור
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

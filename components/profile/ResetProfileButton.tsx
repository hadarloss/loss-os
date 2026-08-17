"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ResetProfileButton({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);

  const handleClick = async () => {
    const confirmed = window.confirm(
      "לאפס את תיק העסק? כל המידע העסקי (תיק העסק + יומן הזיכרון) יימחק לצמיתות, ולא ניתן יהיה " +
        "לעבוד עם צוותי השיווק והמיתוג עד שאורית תעביר היכרות חדשה ותיק העסק יאושר מחדש. " +
        "האישיות והיכולות המקצועיות של הסוכנים לא נפגעות, וגם תוצרים קיימים נשארים."
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      const res = await fetch(`/api/business-profile/reset?brandId=${encodeURIComponent(brandId)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      router.push(`/${brandId}/onboarding`);
      router.refresh();
    } catch {
      window.alert("האיפוס נכשל — נסו שוב.");
      setResetting(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={resetting}>
      {resetting ? "מאפס..." : "♻️ איפוס תיק עסק"}
    </Button>
  );
}

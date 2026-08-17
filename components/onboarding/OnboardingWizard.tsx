"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ONBOARDING_QUESTIONS } from "@/lib/agents/onboardingQuestions";

/**
 * A fixed multi-step questionnaire, not a chat — one question at a time with a progress bar.
 * No LLM call happens per question (nothing to echo back, no token/latency cost per step);
 * אורית only runs once, at the very end, to turn all 12 answers into the full business-file
 * document (POST /api/business-profile/complete-onboarding).
 */
export function OnboardingWizard({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = ONBOARDING_QUESTIONS.length;
  const current = ONBOARDING_QUESTIONS[step];
  const isLast = step === total - 1;
  const currentAnswer = answers[current.id] ?? "";
  const canAdvance = currentAnswer.trim().length > 0;

  const handleAnswerChange = (value: string) => {
    setAnswers((prev) => ({ ...prev, [current.id]: value }));
  };

  const handleNext = () => {
    if (!canAdvance) return;
    if (isLast) {
      void handleSubmit();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/business-profile/complete-onboarding?brandId=${encodeURIComponent(brandId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: ONBOARDING_QUESTIONS.map((q) => ({
              id: q.id,
              question: q.question,
              answer: answers[q.id] ?? "",
            })),
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "השמירה נכשלה");
      }
      router.push(`/${brandId}/business-file`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "השמירה נכשלה");
      setSubmitting(false);
    }
  };

  const progressPct = Math.round(((step + 1) / total) * 100);

  return (
    <div className="flex flex-1 min-h-0 flex-col items-center p-6">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              שאלה {step + 1} מתוך {total}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold leading-snug">{current.question}</h2>
          <Textarea
            key={current.id}
            autoFocus
            value={currentAnswer}
            onChange={(e) => handleAnswerChange(e.target.value)}
            placeholder={current.placeholder}
            className="min-h-32"
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={handleBack} disabled={step === 0 || submitting}>
            → הקודם
          </Button>
          <Button onClick={handleNext} disabled={!canAdvance || submitting}>
            {submitting ? "מכינה את תיק העסק..." : isLast ? "סיום ✓" : "הבא ←"}
          </Button>
        </div>
      </div>
    </div>
  );
}

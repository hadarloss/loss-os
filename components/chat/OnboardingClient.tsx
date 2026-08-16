"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAgentChat } from "@/components/chat/useAgentChat";
import { Button } from "@/components/ui/button";
import { extractText } from "@/components/chat/utils";
import type { AgentLite } from "@/components/chat/RoutingBreadcrumb";
import { modelOptionsForProvider } from "@/lib/agents/modelOptions";

const PROFILE_MARKER = "# תיק העסק";
// Mirrors MIN_ONBOARDING_USER_TURNS in app/api/business-profile/route.ts — the server enforces
// this for real, this copy is only so the UI can show progress and hide the save button before
// that point instead of letting a save attempt fail with no warning.
const MIN_ONBOARDING_USER_TURNS = 12;

export function OnboardingClient({ brandId, agent }: { brandId: string; agent: AgentLite & { id: string } }) {
  const router = useRouter();
  const {
    messages,
    sendMessage,
    isStreaming,
    error,
    routing,
    modelOverride,
    setModelOverride,
    resetConversation,
  } = useAgentChat({
    brandId,
    agentId: agent.id,
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const agentsById = {
    [agent.id]: { name: agent.name, icon: agent.icon, provider: agent.provider, model: agent.model },
  };
  const providerOptions = modelOptionsForProvider(agent.provider);

  const userTurnCount = messages.filter((m) => m.role === "user").length;
  const enoughTurns = userTurnCount >= MIN_ONBOARDING_USER_TURNS;

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastAssistantText = lastAssistant ? extractText(lastAssistant.content) : "";
  const draftReady = !isStreaming && lastAssistant && lastAssistantText.includes(PROFILE_MARKER);
  const showProfileSave = draftReady && enoughTurns;
  const showNeedsMoreQuestions = draftReady && !enoughTurns;

  // A full business-profile draft is long and already has a dedicated page + the save banner
  // above — no need to keep the whole thing sitting in the chat scrollback once it's done
  // streaming. Collapse it to a short pointer instead (the currently-streaming message is left
  // alone so the user still sees it being generated).
  const displayMessages = messages.map((m, i) => {
    const isLastMessage = i === messages.length - 1;
    if (m.role !== "assistant" || (isLastMessage && isStreaming)) return m;
    const text = extractText(m.content);
    if (!text.includes(PROFILE_MARKER)) return m;
    return { ...m, content: "🗂️ טיוטת תיק עסק — לצפייה ושמירה ראו למעלה, או בעמוד \"תיק העסק\"." };
  });

  const handleSaveProfile = async () => {
    if (!lastAssistant) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/business-profile?brandId=${encodeURIComponent(brandId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: lastAssistantText,
          fromOnboarding: true,
          history: messages.map((m) => ({ role: m.role })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "שמירה נכשלה");
      }
      setSaveState("saved");
      router.push(`/${brandId}/business-file`);
      router.refresh();
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : "שמירה נכשלה");
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {showProfileSave && (
        <div className="mx-4 mt-4 flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">אוריתה הכינה תיק עסק מעודכן — לשמור אותו כתיק העסק הרשמי?</div>
            <Button size="sm" onClick={handleSaveProfile} disabled={saveState === "saving"}>
              {saveState === "idle" && "🗂️ שמירה לאישור"}
              {saveState === "saving" && "שומר..."}
              {saveState === "saved" && "✓ נשמר"}
              {saveState === "error" && "שגיאה — נסה/י שוב"}
            </Button>
          </div>
          {saveError && <div className="text-xs text-destructive">{saveError}</div>}
        </div>
      )}
      {showNeedsMoreQuestions && (
        <div className="mx-4 mt-4 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground">
          יש כאן טיוטת תיק עסק, אבל עוד לא עברנו על מספיק שאלות כדי לשמור אותה ({userTurnCount}/
          {MIN_ONBOARDING_USER_TURNS}) — המשיכו את השיחה עם אוריתה כדי לכסות את שאר הנושאים.
        </div>
      )}
      <ChatPanel
        messages={displayMessages}
        onSend={sendMessage}
        isStreaming={isStreaming}
        error={error}
        routing={routing}
        agentsById={agentsById}
        placeholder="ספרו לי על העסק שלכם..."
        onRefresh={resetConversation}
        modelSelector={
          providerOptions.length > 0
            ? {
                current:
                  providerOptions.find((o) => o.value === modelOverride)?.value ??
                  agent.model ??
                  providerOptions[0].value,
                options: providerOptions,
                onChange: setModelOverride,
              }
            : undefined
        }
        emptyState={
          <div className="text-sm text-muted-foreground p-3">
            {agent.icon} שלום! אני {agent.name}. בואו נכיר את העסק שלכם — תוכלו להתחיל פשוט לספר לי
            במה אתם עוסקים ולמי.
          </div>
        }
      />
    </div>
  );
}

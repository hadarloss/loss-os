"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAgentChat } from "@/components/chat/useAgentChat";
import { Button } from "@/components/ui/button";
import { extractText } from "@/components/chat/utils";
import type { AgentLite } from "@/components/chat/RoutingBreadcrumb";

const PROFILE_MARKER = "# תיק העסק";

export function OnboardingClient({ brandId, agent }: { brandId: string; agent: AgentLite & { id: string } }) {
  const router = useRouter();
  const { messages, sendMessage, isStreaming, error, routing } = useAgentChat({
    brandId,
    agentId: agent.id,
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const agentsById = {
    [agent.id]: { name: agent.name, icon: agent.icon, provider: agent.provider, model: agent.model },
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastAssistantText = lastAssistant ? extractText(lastAssistant.content) : "";
  const showProfileSave = !isStreaming && lastAssistant && lastAssistantText.includes(PROFILE_MARKER);

  const handleSaveProfile = async () => {
    if (!lastAssistant) return;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/business-profile?brandId=${encodeURIComponent(brandId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: lastAssistantText }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
      router.refresh();
    } catch {
      setSaveState("error");
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {showProfileSave && (
        <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2.5">
          <div className="text-sm">אוריתה הכינה תיק עסק מעודכן — לשמור אותו כתיק העסק הרשמי?</div>
          <Button size="sm" onClick={handleSaveProfile} disabled={saveState === "saving"}>
            {saveState === "idle" && "🗂️ שמירה"}
            {saveState === "saving" && "שומר..."}
            {saveState === "saved" && "✓ נשמר"}
            {saveState === "error" && "שגיאה — נסה/י שוב"}
          </Button>
        </div>
      )}
      <ChatPanel
        messages={messages}
        onSend={sendMessage}
        isStreaming={isStreaming}
        error={error}
        routing={routing}
        agentsById={agentsById}
        placeholder="ספרו לי על העסק שלכם..."
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

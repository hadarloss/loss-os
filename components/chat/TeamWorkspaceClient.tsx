"use client";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAgentChat } from "@/components/chat/useAgentChat";
import { buildAgentsById } from "@/components/chat/utils";
import { modelOptionsForProvider } from "@/lib/agents/modelOptions";
import type { AgentDef, Team } from "@/lib/agents/types";

export function TeamWorkspaceClient({
  brandId,
  team,
  lead,
  specialists,
}: {
  brandId: string;
  team: Team;
  lead: AgentDef;
  specialists: AgentDef[];
}) {
  const {
    messages,
    sendMessage,
    isStreaming,
    error,
    routing,
    handoffChain,
    activeAgentId,
    modelOverride,
    setModelOverride,
    plan,
    resetConversation,
  } = useAgentChat({ brandId, team });
  const agentsById = buildAgentsById([lead, ...specialists]);
  const activeAgent = (activeAgentId && [lead, ...specialists].find((a) => a.id === activeAgentId)) || lead;
  const defaultModel = activeAgent.model;
  const providerOptions = modelOptionsForProvider(activeAgent.provider);

  return (
    <ChatPanel
      messages={messages}
      onSend={sendMessage}
      isStreaming={isStreaming}
      error={error}
      routing={routing}
      handoffChain={handoffChain}
      agentsById={agentsById}
      placeholder={`כתבו הודעה לצוות ה${team === "branding" ? "מיתוג" : "שיווק"}...`}
      saveContext={{ brandId, team }}
      plan={plan}
      // The team answers as one voice: who works on what is decided (and handed off) internally,
      // which is exactly what the user asked not to have to track.
      hideAgentIdentity
      onRefresh={resetConversation}
      modelSelector={
        providerOptions.length > 0
          ? {
              // A stale override from a previously active agent on a different provider (e.g.
              // picked an OpenAI model while the lead was active, then handed off to an
              // Anthropic specialist) is only ever ignored, never shown selected against a list
              // it doesn't belong to.
              current:
                providerOptions.find((o) => o.value === modelOverride)?.value ??
                defaultModel ??
                providerOptions[0].value,
              options: providerOptions,
              onChange: setModelOverride,
            }
          : undefined
      }
      emptyState={
        <div className="text-sm text-muted-foreground p-3">
          {lead.icon} ספרו לנו מה אתם צריכים — צוות ה{team === "branding" ? "מיתוג" : "שיווק"} יטפל
          בזה מקצה לקצה, והתוצרים המוכנים יחכו לכם בעמוד התוצרים.
        </div>
      }
    />
  );
}

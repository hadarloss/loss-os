"use client";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAgentChat } from "@/components/chat/useAgentChat";
import { buildAgentsById } from "@/components/chat/utils";
import { OMNIROUTE_MODEL_OPTIONS } from "@/lib/agents/modelOptions";
import type { AgentDef, Team } from "@/lib/agents/types";

export function DirectAgentChatClient({
  brandId,
  agent,
  saveTeam,
  extraAgentsForLookup = [],
}: {
  brandId: string;
  agent: AgentDef;
  /** Pass the agent's team if it's marketing/branding to enable "save as output". */
  saveTeam?: Team;
  /** Other agents (e.g. team sidebar members) worth having name/icon lookups for, if referenced elsewhere. */
  extraAgentsForLookup?: AgentDef[];
}) {
  const { messages, sendMessage, isStreaming, error, routing, handoffChain, modelOverride, setModelOverride } =
    useAgentChat({
      brandId,
      agentId: agent.id,
    });
  const agentsById = buildAgentsById([agent, ...extraAgentsForLookup]);

  return (
    <ChatPanel
      messages={messages}
      onSend={sendMessage}
      isStreaming={isStreaming}
      error={error}
      routing={routing}
      handoffChain={handoffChain}
      agentsById={agentsById}
      placeholder={`כתבו הודעה ל${agent.name}...`}
      saveContext={saveTeam ? { brandId, team: saveTeam } : undefined}
      modelSelector={
        agent.provider === "omniroute"
          ? {
              current: modelOverride ?? agent.model ?? OMNIROUTE_MODEL_OPTIONS[0].value,
              options: OMNIROUTE_MODEL_OPTIONS,
              onChange: setModelOverride,
            }
          : undefined
      }
      emptyState={
        <div className="text-sm text-muted-foreground p-3">
          {agent.icon} שלום! אני {agent.name} — {agent.role}. איך אפשר לעזור?
        </div>
      }
    />
  );
}

"use client";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAgentChat } from "@/components/chat/useAgentChat";
import { buildAgentsById } from "@/components/chat/utils";
import { OMNIROUTE_MODEL_OPTIONS } from "@/lib/agents/modelOptions";
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
    approvePlan,
    cancelPlan,
  } = useAgentChat({ brandId, team });
  const agentsById = buildAgentsById([lead, ...specialists]);
  const defaultModel = agentsById[activeAgentId ?? lead.id]?.model ?? lead.model;

  return (
    <ChatPanel
      messages={messages}
      onSend={sendMessage}
      isStreaming={isStreaming}
      error={error}
      routing={routing}
      handoffChain={handoffChain}
      agentsById={agentsById}
      placeholder={`כתבו הודעה ל${lead.name}...`}
      saveContext={{ brandId, team }}
      plan={plan}
      onApprovePlan={approvePlan}
      onCancelPlan={cancelPlan}
      modelSelector={
        lead.provider === "omniroute"
          ? {
              current: modelOverride ?? defaultModel ?? OMNIROUTE_MODEL_OPTIONS[0].value,
              options: OMNIROUTE_MODEL_OPTIONS,
              onChange: setModelOverride,
            }
          : undefined
      }
      emptyState={
        <div className="text-sm text-muted-foreground p-3">
          {lead.icon} שלום! אני {lead.name}, {lead.role}. ספרו לי מה אתם צריכים, ואנתב אתכם
          למומחה/ית המתאימ/ה בצוות.
        </div>
      }
    />
  );
}

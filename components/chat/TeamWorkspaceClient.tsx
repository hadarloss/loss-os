"use client";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAgentChat } from "@/components/chat/useAgentChat";
import { buildAgentsById } from "@/components/chat/utils";
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
  const { messages, sendMessage, isStreaming, error, routing } = useAgentChat({ brandId, team });
  const agentsById = buildAgentsById([lead, ...specialists]);

  return (
    <ChatPanel
      messages={messages}
      onSend={sendMessage}
      isStreaming={isStreaming}
      error={error}
      routing={routing}
      agentsById={agentsById}
      placeholder={`כתבו הודעה ל${lead.name}...`}
      saveContext={{ brandId, team }}
      emptyState={
        <div className="text-sm text-muted-foreground p-3">
          {lead.icon} שלום! אני {lead.name}, {lead.role}. ספרו לי מה אתם צריכים, ואנתב אתכם
          למומחה/ית המתאימ/ה בצוות.
        </div>
      }
    />
  );
}

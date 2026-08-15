import { notFound } from "next/navigation";
import { DirectAgentChatClient } from "@/components/chat/DirectAgentChatClient";
import { getAgentById } from "@/lib/agents/registry";
import type { Team } from "@/lib/agents/types";

export default async function GenericAgentPage({
  params,
}: {
  params: Promise<{ brandId: string; agentId: string }>;
}) {
  const { brandId, agentId } = await params;
  const agent = await getAgentById(agentId);
  if (!agent) notFound();

  const saveTeam: Team | undefined =
    agent.team === "marketing" || agent.team === "branding" ? agent.team : undefined;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="p-4 pb-0">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <span aria-hidden>{agent.icon}</span>
          {agent.name} — {agent.role}
        </h1>
      </div>
      <DirectAgentChatClient key={agentId} brandId={brandId} agent={agent} saveTeam={saveTeam} />
    </div>
  );
}

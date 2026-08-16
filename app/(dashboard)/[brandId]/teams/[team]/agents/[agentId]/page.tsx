import { notFound, redirect } from "next/navigation";
import { TeamSidebar } from "@/components/layout/TeamSidebar";
import { DirectAgentChatClient } from "@/components/chat/DirectAgentChatClient";
import { getAgentById, getTeamTree } from "@/lib/agents/registry";
import { getBusinessProfileStatus } from "@/lib/fs/businessProfile";
import type { Team } from "@/lib/agents/types";

const VALID_TEAMS: Team[] = ["marketing", "branding"];

export default async function TeamAgentPage({
  params,
}: {
  params: Promise<{ brandId: string; team: string; agentId: string }>;
}) {
  const { brandId, team, agentId } = await params;
  if (!VALID_TEAMS.includes(team as Team)) notFound();

  // Same gate as the team home page — a direct link to a specialist shouldn't bypass it.
  const profileStatus = await getBusinessProfileStatus(brandId);
  if (profileStatus === "template") redirect(`/${brandId}/onboarding`);
  if (profileStatus === "pending_approval") redirect(`/${brandId}/business-profile`);

  const [{ lead, specialists }, agent] = await Promise.all([
    getTeamTree(team as Team),
    getAgentById(agentId),
  ]);

  if (!lead || !agent || agent.team !== team) notFound();

  return (
    <div className="flex flex-1 min-h-0">
      <TeamSidebar brandId={brandId} team={team as Team} lead={lead} specialists={specialists} />
      <DirectAgentChatClient
        key={agentId}
        brandId={brandId}
        agent={agent}
        saveTeam={team as Team}
        extraAgentsForLookup={[lead, ...specialists]}
      />
    </div>
  );
}

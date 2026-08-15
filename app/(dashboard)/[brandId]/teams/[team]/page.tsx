import { notFound } from "next/navigation";
import { TeamSidebar } from "@/components/layout/TeamSidebar";
import { TeamWorkspaceClient } from "@/components/chat/TeamWorkspaceClient";
import { getTeamTree } from "@/lib/agents/registry";
import type { Team } from "@/lib/agents/types";

const VALID_TEAMS: Team[] = ["marketing", "branding"];

export default async function TeamPage({
  params,
}: {
  params: Promise<{ brandId: string; team: string }>;
}) {
  const { brandId, team } = await params;
  if (!VALID_TEAMS.includes(team as Team)) notFound();

  const { lead, specialists } = await getTeamTree(team as Team);
  if (!lead) notFound();

  return (
    <div className="flex flex-1 min-h-0">
      <TeamSidebar brandId={brandId} team={team as Team} lead={lead} specialists={specialists} />
      <TeamWorkspaceClient
        key={team}
        brandId={brandId}
        team={team as Team}
        lead={lead}
        specialists={specialists}
      />
    </div>
  );
}

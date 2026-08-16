import { notFound, redirect } from "next/navigation";
import { TeamSidebar } from "@/components/layout/TeamSidebar";
import { TeamWorkspaceClient } from "@/components/chat/TeamWorkspaceClient";
import { getTeamTree } from "@/lib/agents/registry";
import { getBusinessProfileStatus } from "@/lib/fs/businessProfile";
import type { Team } from "@/lib/agents/types";

const VALID_TEAMS: Team[] = ["marketing", "branding"];

export default async function TeamPage({
  params,
}: {
  params: Promise<{ brandId: string; team: string }>;
}) {
  const { brandId, team } = await params;
  if (!VALID_TEAMS.includes(team as Team)) notFound();

  // Marketing/branding work is locked until the business profile has been reviewed and
  // approved — see writeBusinessProfile's status transitions and the reset flow.
  const profileStatus = await getBusinessProfileStatus(brandId);
  if (profileStatus === "template") redirect(`/${brandId}/onboarding`);
  if (profileStatus === "pending_approval") redirect(`/${brandId}/business-profile`);

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

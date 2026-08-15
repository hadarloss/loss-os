import { notFound } from "next/navigation";
import { OnboardingClient } from "@/components/chat/OnboardingClient";
import { getAgentById } from "@/lib/agents/registry";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const agent = await getAgentById("onboarding");
  if (!agent) notFound();

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="p-4 pb-0">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <span aria-hidden>{agent.icon}</span>
          {agent.name} — {agent.role}
        </h1>
      </div>
      <OnboardingClient brandId={brandId} agent={{ id: agent.id, name: agent.name, icon: agent.icon }} />
    </div>
  );
}

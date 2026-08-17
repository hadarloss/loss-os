import { notFound } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
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
      <div className="p-4 pb-0 text-center">
        <h1 className="text-xl font-semibold flex items-center justify-center gap-2">
          <span aria-hidden>{agent.icon}</span>
          בואו נכיר את העסק שלכם
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {agent.name} תרכיב מהתשובות שלכם את תיק העסק המלא — לצפייה ואישור בעמוד "תיק העסק" בסיום.
        </p>
      </div>
      <OnboardingWizard brandId={brandId} />
    </div>
  );
}

import { BusinessProfileClient } from "@/components/profile/BusinessProfileClient";
import { readBusinessProfileFull } from "@/lib/fs/businessProfile";

// Reads live data from disk — must not be statically cached at build time.
export const dynamic = "force-dynamic";

export default async function BusinessFilePage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const profile = await readBusinessProfileFull(brandId);

  return (
    <div className="p-6 max-w-3xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">🗂️ תיק העסק</h1>
        <p className="text-muted-foreground mt-1">
          המסמך שממנו כל הסוכנים במערכת שואבים הקשר. אפשר לערוך ידנית, או לעדכן דרך שיחה עם{" "}
          <a href={`/${brandId}/onboarding`} className="text-primary hover:underline">
            אורית
          </a>
          .
        </p>
      </div>
      <BusinessProfileClient
        brandId={brandId}
        initialContent={profile.content}
        initialStatus={profile.status}
      />
    </div>
  );
}

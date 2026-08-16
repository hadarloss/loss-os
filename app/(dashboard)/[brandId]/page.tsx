import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getTeamTree } from "@/lib/agents/registry";
import { readBusinessProfileFull, isProfileTemplate } from "@/lib/fs/businessProfile";
import { listMemoryEntries } from "@/lib/fs/memoryLog";
import { listOutputs } from "@/lib/fs/outputs";
import { ResetProfileButton } from "@/components/profile/ResetProfileButton";

// Reads live business profile / memory log / outputs from disk — must not be
// statically cached at build time, or a production build would keep showing
// a build-time snapshot forever instead of current data.
export const dynamic = "force-dynamic";

function extractBusinessName(profile: string): string | null {
  const match = profile.match(/^#\s*תיק העסק\s*—\s*(.+)$/m);
  const name = match?.[1]?.trim();
  if (!name || name.startsWith("[")) return null;
  return name;
}

export default async function HomePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const [profile, marketing, branding, outputs] = await Promise.all([
    readBusinessProfileFull(brandId),
    getTeamTree("marketing"),
    getTeamTree("branding"),
    listOutputs(brandId),
  ]);

  const isTemplate = isProfileTemplate(profile.content);
  const isApproved = profile.status === "approved";
  const businessName = extractBusinessName(profile.content);
  const recentMemory = listMemoryEntries(brandId).slice(0, 3);
  const recentOutputs = outputs.slice(0, 3);

  return (
    <div className="p-6 max-w-5xl mx-auto w-full flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">
            {businessName ? `שלום, ${businessName} 👋` : "ברוכים הבאים לצוות ה-AI שלכם 👋"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isTemplate
              ? "עוד לא הוגדר תיק עסק — כדאי להתחיל שם כדי שכל הסוכנים יעבדו עם ההקשר הנכון."
              : profile.status === "pending_approval"
                ? "תיק עסק חדש ממתין לאישור שלכם לפני שהצוותים ייפתחו."
                : "כל הסוכנים כאן עובדים מול תיק העסק שלכם ומתעדכנים לפי היומן הדינאמי."}
          </p>
        </div>
        {!isTemplate && <ResetProfileButton brandId={brandId} />}
      </div>

      {isTemplate && (
        <Card className="ring-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="font-medium">בואו נכיר את העסק</div>
              <div className="text-sm text-muted-foreground">
                שיחה קצרה עם אוריתה תבנה את תיק העסק שממנו כל שאר הסוכנים ניזונים.
              </div>
            </div>
            <Button nativeButton={false} render={<Link href={`/${brandId}/onboarding`}>🧭 להתחלת אונבורדינג</Link>} />
          </CardContent>
        </Card>
      )}

      {profile.status === "pending_approval" && (
        <Card className="ring-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="font-medium">תיק העסק מוכן לאישור</div>
              <div className="text-sm text-muted-foreground">
                אוריתה סיימה את ההיכרות — יש לעבור על תיק העסק ולאשר אותו לפני שאפשר לעבוד עם הצוותים.
              </div>
            </div>
            <Button
              nativeButton={false}
              render={<Link href={`/${brandId}/business-profile`}>🗂️ לצפייה ואישור</Link>}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <TeamCard
          href={`/${brandId}/teams/marketing`}
          icon={marketing.lead?.icon ?? "📣"}
          title="צוות שיווק"
          leadName={marketing.lead?.name}
          count={marketing.specialists.length}
          locked={!isApproved}
          brandId={brandId}
        />
        <TeamCard
          href={`/${brandId}/teams/branding`}
          icon={branding.lead?.icon ?? "🎨"}
          title="צוות מיתוג"
          leadName={branding.lead?.name}
          count={branding.specialists.length}
          locked={!isApproved}
          brandId={brandId}
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">🧠 יומן זיכרון</CardTitle>
            <CardDescription>{recentMemory.length} רשומות אחרונות</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentMemory.length === 0 && <p className="text-sm text-muted-foreground">אין עדיין רשומות.</p>}
            {recentMemory.map((entry, i) => (
              <p key={i} className="text-sm truncate">
                {entry.summary}
              </p>
            ))}
            <Link href={`/${brandId}/memory-log`} className="text-sm text-primary hover:underline mt-1">
              לצפייה ביומן המלא ←
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">📦 תוצרים אחרונים</CardTitle>
            <CardDescription>{outputs.length} תוצרים בסך הכל</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentOutputs.length === 0 && <p className="text-sm text-muted-foreground">אין עדיין תוצרים שמורים.</p>}
            {recentOutputs.map((o) => (
              <p key={o.filename} className="text-sm truncate">
                {o.title}
              </p>
            ))}
            <Link href={`/${brandId}/outputs`} className="text-sm text-primary hover:underline mt-1">
              לגלריית התוצרים ←
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">🗂️ פרופיל עסקי</CardTitle>
            <CardDescription>
              {isTemplate ? "טרם הוגדר" : profile.status === "pending_approval" ? "ממתין לאישור" : "מאושר"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/${brandId}/business-profile`} className="text-sm text-primary hover:underline">
              לצפייה/עריכה ←
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TeamCard({
  href,
  icon,
  title,
  leadName,
  count,
  locked,
  brandId,
}: {
  href: string;
  icon: string;
  title: string;
  leadName?: string;
  count: number;
  locked: boolean;
  brandId: string;
}) {
  const card = (
    <Card
      className={
        locked
          ? "opacity-60 grayscale-[0.3]"
          : "hover:ring-primary/40 transition-shadow hover:shadow-md"
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span aria-hidden>{locked ? "🔒" : icon}</span>
          {title}
        </CardTitle>
        <CardDescription>
          {locked
            ? "נעול — צריך להשלים ולאשר את תיק העסק תחילה"
            : leadName
              ? `בניהול ${leadName} · ${count} מומחים בצוות`
              : `${count} מומחים בצוות`}
        </CardDescription>
      </CardHeader>
    </Card>
  );

  // Locked cards route to whichever step is actually next (onboarding vs. approval) instead of
  // the team itself — the team page would just redirect there anyway, this saves the round trip.
  return <Link href={locked ? `/${brandId}/business-profile` : href}>{card}</Link>;
}

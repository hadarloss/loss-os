"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandSwitcher } from "@/components/layout/BrandSwitcher";

interface NavItem {
  href: (brandId: string) => string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: (b) => `/${b}`, label: "בית", icon: "🏠" },
  { href: (b) => `/${b}/teams/marketing`, label: "שיווק", icon: "📣" },
  { href: (b) => `/${b}/teams/branding`, label: "מיתוג", icon: "🎨" },
  { href: (b) => `/${b}/onboarding`, label: "אוריתה", icon: "🧭" },
  { href: (b) => `/${b}/agents/quality_assurance`, label: "ערן — QA", icon: "✅" },
  { href: (b) => `/${b}/memory-log`, label: "יומן זיכרון", icon: "🧠" },
  { href: (b) => `/${b}/business-profile`, label: "פרופיל עסקי", icon: "🗂️" },
  { href: (b) => `/${b}/outputs`, label: "תוצרים", icon: "📦" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

async function handleLogout() {
  await fetch("/api/auth/logout", { method: "POST" });
  // Full navigation (not router.push) so proxy.ts re-checks with the now-cleared cookie.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
}

const NON_BRAND_SEGMENTS = new Set(["admin", "account"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // First path segment doubles as brandId on every dashboard route except the
  // brand-picker root ("/") and the non-brand-scoped pages ("/admin/...", "/account").
  const [firstSegment] = pathname.split("/").filter(Boolean);
  const brandId = firstSegment && !NON_BRAND_SEGMENTS.has(firstSegment) ? firstSegment : null;

  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    // Refetch whenever the active brand changes (not just on mount) — otherwise a
    // brand created or switched to after the initial load never appears here, and
    // the <select>'s value falls back to whatever option happens to be first.
    fetch("/api/brands")
      .then((r) => r.json())
      .then((d) => setBrands(d.brands ?? []))
      .catch(() => {});
  }, [brandId]);

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setIsSuperAdmin(!!d.isSuperAdmin))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!isSuperAdmin) return;
    // Also refetch on navigation so the badge clears right after an approve/reject.
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => setPendingCount(d.pending?.length ?? 0))
      .catch(() => {});
  }, [isSuperAdmin, pathname]);

  const accountLinks = (
    <>
      <Link
        href="/account"
        className={cn(
          "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
          isActive(pathname, "/account")
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )}
      >
        <span aria-hidden>👤</span>
        <span>אזור אישי</span>
      </Link>
      {isSuperAdmin && (
        <Link
          href="/admin/users"
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
            isActive(pathname, "/admin/users")
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            <span aria-hidden>🛡️</span>
            <span>בקשות התחברות</span>
          </span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 leading-none">
              {pendingCount}
            </span>
          )}
        </Link>
      )}
    </>
  );

  const homeHref = brandId ? `/${brandId}` : "/";

  return (
    <div className="flex h-full w-full">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-e border-border bg-sidebar text-sidebar-foreground p-3 gap-1">
        <Link href={homeHref} className="px-2 py-3 mb-2 rounded-lg hover:bg-sidebar-accent/60 transition-colors">
          <div className="text-sm font-semibold text-sidebar-foreground">צוות ה-AI שלי</div>
          <div className="text-xs text-muted-foreground">שיווק ומיתוג, במקום אחד</div>
        </Link>

        {brandId && <BrandSwitcher brands={brands} activeBrandId={brandId} />}

        <nav className="flex flex-col gap-0.5 mt-1">
          {brandId &&
            NAV_ITEMS.map((item) => {
              const href = item.href(brandId);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    isActive(pathname, href)
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <span aria-hidden>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5 pt-1 border-t border-border">
          {accountLinks}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <span aria-hidden>🚪</span>
            <span>יציאה</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="md:hidden border-b border-border p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Link href={homeHref} className="text-sm font-semibold">
              צוות ה-AI שלי
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/account" className="text-xs text-muted-foreground hover:text-foreground">
                👤 אזור אישי
              </Link>
              {isSuperAdmin && (
                <Link
                  href="/admin/users"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  🛡️ בקשות
                  {pendingCount > 0 && (
                    <span className="rounded-full bg-destructive text-destructive-foreground text-[10px] px-1.5 leading-none">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                🚪 יציאה
              </button>
            </div>
          </div>
          {brandId && (
            <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
              {NAV_ITEMS.map((item) => {
                const href = item.href(brandId);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap shrink-0 transition-colors",
                      isActive(pathname, href)
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/60"
                    )}
                  >
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}
        </header>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}

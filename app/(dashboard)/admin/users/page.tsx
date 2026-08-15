import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { listPendingUsers } from "@/lib/db/queries";
import { UsersAdminClient } from "@/components/admin/UsersAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user || !user.is_super_admin) {
    redirect("/");
  }

  const pending = listPendingUsers().map((u) => ({ id: u.id, email: u.email, createdAt: u.created_at }));

  return (
    <div className="p-6 max-w-2xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">👤 ניהול משתמשים</h1>
        <p className="text-muted-foreground mt-1">משתמשים הממתינים לאישור כניסה למערכת.</p>
      </div>
      <UsersAdminClient initialPending={pending} />
    </div>
  );
}

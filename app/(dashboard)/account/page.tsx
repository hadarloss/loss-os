import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { AccountClient } from "@/components/account/AccountClient";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="p-6 max-w-lg mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">👤 אזור אישי</h1>
        <p className="text-muted-foreground mt-1">{user.email}</p>
      </div>
      <AccountClient />
    </div>
  );
}

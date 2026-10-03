import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole, scopeLabel } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Today at your outlet · Katapatha",
  description: "Store manager workspace for Waypoint Group deliveries.",
};

/**
 * The store console had no layout at all until now — its pages rendered as a
 * bare <main> with no rail, no sign-out and no indication of which outlet the
 * session was scoped to.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("STORE_MANAGER", "/store");

  return (
    <AppShell role="STORE_MANAGER" name={user.name} scope={scopeLabel(user)}>
      {children}
    </AppShell>
  );
}

import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole, scopeLabel } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Store manager · Katapatha",
  description: "Store manager workspace for a Waypoint Group outlet.",
};

/**
 * The guard matters here. The sidebar this replaces loaded /auth/me inside a
 * try that swallowed the failure — "the sidebar is cosmetic; signed-out users
 * still see the shell" — so an unauthenticated visitor got the store console
 * and a loader could open it. requireRole sends them to sign-in and to their
 * own workspace respectively.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("STORE_MANAGER", "/store");

  return (
    <AppShell role="STORE_MANAGER" name={user.name} scope={scopeLabel(user)}>
      {children}
    </AppShell>
  );
}

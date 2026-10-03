import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole, scopeLabel } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Loader · Katapatha",
  description: "Dock loader workspace for Waypoint Group deliveries.",
};

/**
 * The scope line comes from the session rather than the hardcoded "Peliyagoda
 * dock" the previous sidebar rendered. A loader at Kandy hub was being told
 * they were at Peliyagoda.
 */
export default async function LoaderLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("LOADER", "/loader");

  return (
    <AppShell role="LOADER" name={user.name} scope={scopeLabel(user)}>
      {children}
    </AppShell>
  );
}

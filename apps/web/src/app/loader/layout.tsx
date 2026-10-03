import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole, scopeLabel } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Dock · Katapatha",
  description: "Dock loader workspace for Waypoint Group deliveries.",
};

export default async function LoaderLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("LOADER", "/loader");

  return (
    <AppShell role="LOADER" name={user.name} scope={scopeLabel(user)}>
      {children}
    </AppShell>
  );
}

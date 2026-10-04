import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole, scopeLabel } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Administration · Katapatha",
  description: "Accounts, outlets, vehicles and the Waypoint-wide overview.",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("ADMIN", "/admin");

  return (
    <AppShell role="ADMIN" name={user.name} scope={scopeLabel(user)}>
      {children}
    </AppShell>
  );
}

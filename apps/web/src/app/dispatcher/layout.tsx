import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole, scopeLabel } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Delivery operations · Katapatha",
  description: "Dispatcher planning workspace for Waypoint Group deliveries.",
};

export default async function DispatcherLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("DISPATCHER", "/dispatcher");

  return (
    <AppShell role="DISPATCHER" name={user.name} scope={scopeLabel(user)}>
      {children}
    </AppShell>
  );
}

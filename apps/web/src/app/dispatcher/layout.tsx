import type { Metadata } from "next";
import { AppShell } from "../(shell)/app-shell";

export const metadata: Metadata = {
  title: "Planning desk · Katapatha",
  description: "Dispatcher planning workspace for Waypoint Group deliveries.",
};

export default function DispatcherLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

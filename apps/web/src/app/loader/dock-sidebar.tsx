import { api } from "@/lib/api";
import { DockSidebarClient } from "./dock-sidebar-client";

async function loadUser(): Promise<{ name: string; role: string } | null> {
  try {
    const client = await api();
    const me = await client.GET("/auth/me");
    if (me.data) return { name: me.data.name, role: me.data.role };
  } catch {
    /* sidebar is cosmetic; signed-out users still see the shell */
  }
  return null;
}

export async function DockSidebar() {
  const user = await loadUser();
  return <DockSidebarClient user={user} />;
}

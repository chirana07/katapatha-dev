import { api } from "@/lib/api";
import { StoreSidebarClient } from "./store-sidebar-client";

async function loadUser(): Promise<{
  user: { name: string; role: string } | null;
  outletId: string | null;
}> {
  try {
    const client = await api();
    const me = await client.GET("/auth/me");
    if (me.data) {
      return {
        user: { name: me.data.name, role: me.data.role },
        outletId: me.data.outletId ?? null,
      };
    }
  } catch {
    /* sidebar is cosmetic; signed-out users still see the shell */
  }
  return { user: null, outletId: null };
}

export async function StoreSidebar() {
  const { user, outletId } = await loadUser();
  return <StoreSidebarClient user={user} outletId={outletId} />;
}

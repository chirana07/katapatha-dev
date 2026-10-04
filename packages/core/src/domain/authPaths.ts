import type { Role } from "./roles";

export const HOME_FOR_ROLE: Record<Role, string> = {
  DISPATCHER: "/dispatcher",
  LOADER: "/loader",
  DRIVER: "/driver",
  STORE_MANAGER: "/store",
  ADMIN: "/admin",
};

export const PREFIX_FOR_ROLE: Record<Role, string> = {
  DISPATCHER: "/dispatcher",
  LOADER: "/loader",
  DRIVER: "/driver",
  STORE_MANAGER: "/store",
  ADMIN: "/admin",
};

/** Accept only an internal destination owned by the signed-in role. */
export function safePostLoginPath(next: string, role: Role): string {
  const fallback = HOME_FOR_ROLE[role];
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }

  try {
    const url = new URL(next, "https://katapatha.local");
    if (url.origin !== "https://katapatha.local") return fallback;
    const prefix = PREFIX_FOR_ROLE[role];
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

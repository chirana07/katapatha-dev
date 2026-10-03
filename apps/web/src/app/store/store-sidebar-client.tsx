"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "My orders", href: "/store", match: /^\/store(\/orders\/[^/]+)?$/, icon: "orders" as const },
  { label: "Place an order", href: "/store/new", match: /^\/store\/new/, icon: "place" as const },
  { label: "Delivery history", href: "/store/history", match: /^\/store\/history/, icon: "history" as const },
  { label: "Report an issue", href: "/store/issues", match: /^\/store\/issues/, icon: "issue" as const },
] as const;

function NavIcon({ kind }: { kind: "orders" | "place" | "history" | "issue" }) {
  const common = "h-4 w-4 shrink-0";
  if (kind === "orders")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    );
  if (kind === "place")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
      </svg>
    );
  if (kind === "history")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
      <path d="M10.3 3.7L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v5M12 17v.01" />
    </svg>
  );
}

export function StoreSidebarClient({
  user,
  outletId,
}: {
  user: { name: string; role: string } | null;
  outletId: string | null;
}) {
  const pathname = usePathname() ?? "/store";
  const initials = user
    ? user.name
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "SM";

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-[color:var(--c-navy)]/20 bg-[color:var(--c-navy)] p-4 text-white lg:sticky lg:top-0 lg:flex">
      <div className="flex flex-col gap-5">
        <Link href="/store" className="flex items-center gap-2">
          <Image src="/logo/katapatha-lockup-light.png" alt="Katapatha" width={1600} height={409} className="h-auto w-32" />
        </Link>
        <div className="rounded-[var(--radius-card)] bg-white/10 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Store manager</p>
          <p className="mt-0.5 text-sm font-semibold text-white">{outletId ?? "Outlet"}</p>
        </div>
        <nav aria-label="Store workspace" className="flex flex-col gap-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const active = item.match.test(pathname);
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                prefetch={false}
                className={`flex min-h-10 items-center gap-2.5 rounded-[var(--radius-control)] px-3 ${
                  active ? "bg-white text-ink font-semibold" : "text-white/80 hover:bg-white/10"
                }`}
              >
                <NavIcon kind={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-white/5 p-3 text-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-[color:var(--c-navy)]">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{user?.name ?? "Not signed in"}</p>
            <p className="truncate text-xs text-white/60">{user ? "Store manager" : "Open /sign-in"}</p>
          </div>
        </div>
        <Link
          href="/sign-out"
          aria-label="Sign out"
          prefetch={false}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}

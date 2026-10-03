"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dock", href: "/loader", match: /^\/loader(\/trips\/.*)?$/, icon: "dock" as const },
  { label: "Loading progress", href: "/loader/progress", match: /^\/loader\/progress/, icon: "progress" as const },
  { label: "Reports", href: "/loader/reports", match: /^\/loader\/reports/, icon: "reports" as const },
] as const;

function NavIcon({ kind }: { kind: "dock" | "progress" | "reports" }) {
  const common = "h-4 w-4 shrink-0";
  if (kind === "dock")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M3 7h13v10H3z" /><path d="M16 10h3l2 3v4h-5" /><circle cx="7" cy="19" r="1.5" /><circle cx="18" cy="19" r="1.5" />
      </svg>
    );
  if (kind === "progress")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
        <path d="M4 20V8M10 20V4M16 20v-8" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function DockSidebarClient({ user }: { user: { name: string; role: string } | null }) {
  const pathname = usePathname() ?? "/loader";
  const initials = user
    ? user.name
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "LD";

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-[color:var(--c-navy)]/20 bg-[color:var(--c-navy)] p-4 text-white lg:sticky lg:top-0 lg:flex">
      <div className="flex flex-col gap-5">
        <Link href="/loader" className="flex items-center gap-2">
          <Image src="/logo/katapatha-lockup-light.png" alt="Katapatha" width={1600} height={409} className="h-auto w-32" />
        </Link>
        <div className="rounded-[var(--radius-card)] bg-white/10 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Loader</p>
          <p className="mt-0.5 text-sm font-semibold text-white">Peliyagoda dock</p>
        </div>
        <nav aria-label="Loader workspace" className="flex flex-col gap-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const active = item.match.test(pathname);
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
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
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-[color:var(--c-navy)]">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{user?.name ?? "Not signed in"}</p>
            <p className="truncate text-xs text-white/60">{user ? "Loader" : "Open /sign-in"}</p>
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

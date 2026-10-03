import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { Role } from "@katapatha/core/domain/roles";
import { NAV } from "./nav";
import { MobileNav, RailNav } from "./rail-nav";
import { signOut } from "@/app/(shell)/sign-out";

/**
 * The workspace shell, for every role that has one.
 *
 * The previous version was hardcoded to DISPATCHER — it redirected any other
 * role away and rendered a single nav item. Meanwhile the loader and driver
 * hand-rolled their own navy top bars and the store console had no shell at
 * all. This is the one rail, driven by `NAV`.
 *
 * Session and role checking are deliberately NOT here any more. They live in
 * `requireRole()` so that server actions can run the same check; a layout
 * cannot guard an action. The layout calls `requireRole` and passes the result
 * in, which also means the shell makes no network call of its own.
 *
 * DESIGN.md: "persistent 212px rail".
 */
export function AppShell({
  role,
  name,
  scope,
  children,
}: {
  role: Role;
  /** The signed-in person. */
  name: string;
  /** Depot, dock or outlet — the records this session can touch. */
  scope: string;
  children: ReactNode;
}) {
  const nav = NAV[role];
  const navLabel = `${nav.title} sections`;

  return (
    <div className="min-h-screen bg-canvas text-ink md:grid md:grid-cols-[212px_minmax(0,1fr)]">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to workspace
      </a>

      <aside className="hidden min-h-screen flex-col bg-rail px-4 py-5 text-white md:flex">
        <Link href={nav.home} className="flex min-h-11 items-center px-2">
          <Image
            src="/logo/katapatha-lockup-dark.png"
            alt="Katapatha"
            width={1600}
            height={417}
            className="h-auto w-36"
            priority
          />
        </Link>

        {/* The scope chip. Which depot, dock or outlet this session acts on —
            the same scope the API's authorization predicates enforce. */}
        <div className="mt-5 rounded-control bg-action px-3 py-2 text-ink">
          <p className="font-bold leading-tight">{nav.title}</p>
          <p className="truncate text-xs font-medium opacity-80">{scope}</p>
        </div>

        <RailNav items={nav.items} label={navLabel} />

        {nav.quickActions?.length ? (
          <div className="mt-6 border-t border-white/15 pt-4">
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-white/50">Quick actions</p>
            <nav aria-label="Quick actions" className="mt-2 flex flex-col gap-1">
              {nav.quickActions.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-11 items-center rounded-control px-3 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        ) : null}

        <div className="mt-auto border-t border-white/15 pt-4">
          <p className="truncate px-2 font-semibold">{name}</p>
          <p className="mt-0.5 truncate px-2 text-xs text-white/65">{nav.title}</p>
          <form action={signOut} className="mt-3">
            <button
              type="submit"
              className="min-h-11 w-full rounded-control border border-white/20 px-3 text-left text-sm font-semibold hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-line bg-rail text-white md:hidden">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4">
            <Link href={nav.home} className="flex items-center">
              <Image
                src="/logo/katapatha-lockup-dark.png"
                alt="Katapatha"
                width={1600}
                height={417}
                className="h-auto w-28"
              />
            </Link>
            <div className="flex items-center gap-2">
              <span className="hidden truncate text-xs text-white/70 min-[420px]:inline">{scope}</span>
              <form action={signOut}>
                <button type="submit" className="min-h-11 rounded-control border border-white/20 px-3 text-sm font-semibold">
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <span className="sr-only">Signed in as {name}</span>
          <MobileNav items={nav.items} label={navLabel} />
        </header>

        <div id="workspace" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { Role } from "@katapatha/core/domain/roles";
import { NAV, initialsOf } from "./nav";
import { NavIcon } from "./nav-icon";
import { MobileNav, RailNav } from "./rail-nav";

/**
 * The workspace shell, for every role that has one.
 *
 * There were three. The dispatcher used a shell hardcoded to DISPATCHER — it
 * redirected every other role away and rendered a single nav item — while the
 * loader and store each got their own sidebar in the Figma visual pass, byte
 * for byte identical to each other apart from the nav items and the labels.
 * This is those three, folded into one, keeping the visual treatment they
 * arrived with: the chip, the icons, the white active state and the avatar
 * footer.
 *
 * Session and role checking are deliberately NOT here. They live in
 * `requireRole()` so a server action can run the same check; a layout cannot
 * guard an action. The layout calls it and passes the result in, so the shell
 * makes no network call of its own — the sidebars it replaces each fetched
 * /auth/me themselves and swallowed the failure, which is why a signed-out
 * user still saw the store and loader consoles.
 *
 * Width is 212px, per DESIGN.md's "persistent 212px rail". The sidebars this
 * replaces had drifted to w-64.
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
  const navLabel = `${nav.title} workspace`;
  const initials = initialsOf(name, nav.fallbackInitials);

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to workspace
      </a>

      <aside className="hidden h-screen w-53 shrink-0 flex-col justify-between bg-rail p-4 text-white lg:sticky lg:top-0 lg:flex">
        <div className="flex flex-col gap-5">
          <Link href={nav.home} className="flex items-center">
            <Image
              src="/logo/katapatha-lockup-light.png"
              alt="Katapatha"
              width={1600}
              height={409}
              className="h-auto w-32"
              priority
            />
          </Link>

          {/* Which depot, dock or outlet this session acts on — the same scope
              the API's authorization predicates enforce. */}
          <div className="rounded-card bg-white/10 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{nav.title}</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{scope}</p>
          </div>

          <RailNav role={role} label={navLabel} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-card bg-white/5 p-3 text-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-rail">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{name}</p>
              <p className="truncate text-xs text-white/60">{nav.title}</p>
            </div>
          </div>
          <SignOutLink />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-rail text-white lg:hidden">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4">
            <Link href={nav.home} className="flex items-center">
              <Image
                src="/logo/katapatha-lockup-light.png"
                alt="Katapatha"
                width={1600}
                height={409}
                className="h-auto w-28"
              />
            </Link>
            <div className="flex items-center gap-3">
              <span className="truncate text-xs text-white/70">{scope}</span>
              <SignOutLink />
            </div>
          </div>
          <span className="sr-only">Signed in as {name}</span>
          <MobileNav role={role} label={navLabel} />
        </header>

        <div id="workspace" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A link, not a form.
 *
 * /sign-out is a GET route handler that invalidates the session server-side and
 * clears the cookie, so the control works without JavaScript and without a
 * <form> in the middle of the rail's flex layout.
 */
function SignOutLink() {
  return (
    <Link
      href="/sign-out"
      aria-label="Sign out"
      prefetch={false}
      className="inline-flex size-11 items-center justify-center rounded-control text-white/70 hover:bg-white/10 hover:text-white"
    >
      <NavIcon kind="sign-out" />
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, type NavItem } from "./nav";
import { NavIcon } from "./nav-icon";

/**
 * The nav links, the shell's only client component.
 *
 * A layout does not receive the pathname, and the alternatives are worse: a
 * middleware-set `x-pathname` header couples the rail to middleware for
 * nothing, and making the whole shell a client component would drag the logo,
 * the chip and the avatar across the boundary with it.
 *
 * `NavItem` carries a RegExp, which does not survive the server/client
 * serialisation boundary — so the matching happens here and the items are
 * imported rather than passed as props.
 */

export function RailNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label={label} className="flex flex-col gap-1 text-sm">
      {items.map((item) => {
        const active = isCurrent(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            prefetch={false}
            className={`flex min-h-11 items-center gap-2.5 rounded-control px-3 ${
              active ? "bg-white font-semibold text-ink" : "text-white/80 hover:bg-white/10"
            }`}
          >
            <NavIcon kind={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Below the rail's breakpoint the sections become a horizontally scrolling
 * strip. The strip scrolls; the page does not — DESIGN.md requires no
 * page-wide horizontal scroll at 390px.
 */
export function MobileNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname() ?? "";
  if (!items.length) return null;

  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto px-3 pb-2">
      {items.map((item) => {
        const active = isCurrent(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            prefetch={false}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-sm ${
              active ? "bg-white font-semibold text-ink" : "font-medium text-white/80"
            }`}
          >
            <NavIcon kind={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

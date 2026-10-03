"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, type NavItem } from "./nav";

/**
 * The nav links, split out as the shell's only client component.
 *
 * A layout does not receive the pathname, and the alternatives are worse: a
 * middleware-set `x-pathname` header couples the rail to middleware for
 * nothing, and making the whole shell a client component would drag the logo,
 * the scope chip and the sign-out form across the boundary with it. `NavItem`
 * is plain data, so passing it through costs a few bytes of serialised props.
 */

export function RailNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="mt-6 flex flex-col gap-1">
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-control px-3 text-sm transition-colors ${
              current
                ? "bg-white/10 font-semibold text-white"
                : "font-medium text-white/75 hover:bg-white/5 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Below `md` the rail becomes a horizontally scrolling strip. The strip
 * scrolls; the page does not — DESIGN.md requires no page-wide horizontal
 * scroll at 390px.
 */
export function MobileNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  if (!items.length) return null;

  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto px-3 pb-2">
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-control px-3 text-sm ${
              current ? "bg-white/15 font-semibold text-white" : "font-medium text-white/75"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

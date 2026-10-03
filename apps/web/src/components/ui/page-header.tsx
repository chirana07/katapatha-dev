import type { ReactNode } from "react";

/**
 * The header every workspace page opens with.
 *
 * DESIGN.md: "Each view has one visually dominant action" and "Keep page titles
 * compact and operational." So `action` is a single node, not a list — a second
 * dominant action is a design decision that should be hard to make by accident.
 * Secondary controls go in `aside`, which renders them quietly beside it.
 */
export function PageHeader({
  title,
  subtitle,
  aside,
  action,
}: {
  title: string;
  /** One line. What this screen is for, in the operator's words. */
  subtitle?: string;
  /** Date pickers, scope switchers, live-updated stamps. */
  aside?: ReactNode;
  /** The one dominant action. */
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {aside || action ? (
        <div className="flex flex-wrap items-center gap-2">
          {aside}
          {action}
        </div>
      ) : null}
    </header>
  );
}

/**
 * The page body. One place that owns the gutter and the max width, so a new
 * screen cannot quietly disagree with the rest of the product about either.
 */
export function PageBody({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-6">{children}</main>;
}

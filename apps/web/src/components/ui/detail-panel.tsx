import type { ReactNode } from "react";

/**
 * The sticky right-hand context panel.
 *
 * Every dense dispatcher and loader screen in the designs is the same shape: a
 * list on the left, the selected record on the right, and the actions for that
 * record pinned to the bottom of the panel. DESIGN.md calls it the "optional
 * sticky context panel" in the desktop layout.
 *
 * Below `lg` it stops being sticky and simply follows the list, because a
 * sticky panel on a short viewport eats the content it is meant to explain.
 */
export function DetailPanel({
  children,
  footer,
}: {
  children: ReactNode;
  /** The record's actions. Ends with the one dominant action. */
  footer?: ReactNode;
}) {
  return (
    <aside className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-card border border-line bg-surface lg:sticky lg:top-4">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer ? (
        <div className="flex flex-wrap gap-2 border-t border-line bg-raised p-4">{footer}</div>
      ) : null}
    </aside>
  );
}

/**
 * The list-plus-panel split. One place owns the breakpoint, so the dispatcher's
 * five list screens cannot disagree about where the panel appears.
 */
export function SplitLayout({ list, panel }: { list: ReactNode; panel: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">{list}</div>
      {panel}
    </div>
  );
}

/**
 * A labelled fact. The designs repeat this grid constantly — items / volume /
 * weight, capacity / weight / orders / distance, loaded / short / dock stock.
 *
 * Numbers are tabular by default because almost every use is a quantity, and
 * DESIGN.md requires tabular numerals for counts, times and capacities.
 */
export function Facts({ items }: { items: { label: string; value: ReactNode; tone?: "bad" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-control border border-line p-3">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className={`tabular mt-0.5 font-bold ${item.tone === "bad" ? "text-bad-ink" : "text-ink"}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled block inside the panel. */
export function PanelSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">{title}</h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

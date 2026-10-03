import type { OrderItem } from "@/lib/order-items";
import { hasItems, productCount, quantityLabel } from "@/lib/order-items";

/**
 * What an order contains, as the store, dock, driver and dispatcher read it.
 *
 * Read-only context. Orders are still loaded, delivered and planned in units;
 * nothing here is a count anyone enters, so it carries no checkbox, stepper or
 * "of N" that could be mistaken for one. It renders nothing for an order with
 * no items (placed as units only, or the competition's own).
 *
 * Plain markup with no hooks, so a server page and a client row can both use
 * it. The collapsible form is a native <details>: keyboard and screen-reader
 * behaviour come from the platform, and it works before any script has run.
 */

function Lines({ items, compact }: { items: readonly OrderItem[]; compact?: boolean }) {
  return (
    <ul className={`flex flex-col ${compact ? "gap-1" : "gap-1.5"} text-sm`}>
      {items.map((item) => (
        <li key={item.sku} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            <span className="text-ink">{item.name}</span>
            <span className="ml-1.5 font-mono text-xs text-muted">{item.sku}</span>
          </span>
          <span className="tabular shrink-0 font-semibold text-ink">{quantityLabel(item.quantity, item.unitLabel)}</span>
        </li>
      ))}
    </ul>
  );
}

function Disclosure({ items, label, className = "" }: { items: readonly OrderItem[]; label?: string; className?: string }) {
  return (
    <details className={`group ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-link [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block text-xs transition-transform group-open:rotate-90">&#9656;</span>
        {label ?? productCount(items)}
      </summary>
      <div className="pb-2 pl-4">
        <Lines items={items} compact />
      </div>
    </details>
  );
}

/**
 * `mode`
 *   list         always open: a panel or a page with room for it
 *   collapsible  a disclosure on every width: a table cell or a card
 *   responsive   a disclosure below md, an open list from md up (the dock,
 *                where a wide screen has the room and a phone does not)
 */
export function OrderItems({
  items,
  mode = "list",
  label,
  className = "",
}: {
  items: readonly OrderItem[] | null | undefined;
  mode?: "list" | "collapsible" | "responsive";
  /** The disclosure's summary; defaults to "3 products". */
  label?: string;
  className?: string;
}) {
  if (!hasItems(items)) return null;
  if (mode === "list") {
    return (
      <div className={className}>
        <Lines items={items} />
      </div>
    );
  }
  if (mode === "collapsible") return <Disclosure items={items} label={label} className={className} />;
  return (
    <div className={className}>
      <Disclosure items={items} label={label} className="md:hidden" />
      <div className="hidden md:block">
        <Lines items={items} compact />
      </div>
    </div>
  );
}

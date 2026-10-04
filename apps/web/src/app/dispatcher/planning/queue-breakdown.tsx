import type { components } from "@katapatha/contracts/types";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { BrandPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";
import { TEMPS } from "@/lib/temperature";
import { sumVolume, sumWeight } from "../order-status";

type Order = components["schemas"]["Order"];

const BRANDS = ["Fresh", "Style", "Tech"] as const;

/**
 * What is in the queue, grouped the way the allocator has to think about it:
 * brand (one brand per trip) and temperature (chilled and frozen need a
 * refrigerated vehicle). It is the answer to "is it time to close the queue?" and uses only
 * the day's orders, so it works before any plan exists.
 */
export function QueueBreakdown({ orders }: { orders: Order[] }) {
  const rows = BRANDS.flatMap((brand) =>
    TEMPS.map((temp) => {
      const group = orders.filter((o) => o.brand === brand && o.tempRequirement === temp);
      return { brand, temp, count: group.length, units: group.reduce((n, o) => n + o.units, 0), volume: sumVolume(group), weight: sumWeight(group) };
    }),
  ).filter((row) => row.count > 0);

  return (
    <section aria-labelledby="queue-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="queue-heading" className="text-lg font-bold text-ink">
          Order queue
        </h2>
        <p className="text-sm text-muted">The day&apos;s orders by brand and load type.</p>
      </div>
      <DataTable
        caption="Orders by brand and load type"
        empty={rows.length === 0 ? <EmptyState title="No orders in the queue" detail="Orders appear here as outlets place them." /> : undefined}
        head={
          <tr>
            <Th>Brand</Th>
            <Th>Load</Th>
            <Th numeric>Orders</Th>
            <Th numeric>Items</Th>
            <Th numeric>Volume</Th>
            <Th numeric>Weight</Th>
          </tr>
        }
        cards={rows.map((row) => (
          <RowCard key={`${row.brand}-${row.temp}`}>
            <div className="flex items-center justify-between gap-3">
              <BrandPill brand={row.brand} />
              <span className="text-sm capitalize text-muted">{row.temp}</span>
            </div>
            <p className="tabular mt-2 text-sm text-muted">
              {row.count} orders · {row.units} items · {row.volume.toFixed(1)} m³ · {Math.round(row.weight)} kg
            </p>
          </RowCard>
        ))}
      >
        {rows.map((row) => (
          <Tr key={`${row.brand}-${row.temp}`}>
            <Td>
              <BrandPill brand={row.brand} />
            </Td>
            <Td>
              <span className="capitalize">{row.temp}</span>
            </Td>
            <Td numeric>{row.count}</Td>
            <Td numeric>{row.units}</Td>
            <Td numeric>{row.volume.toFixed(1)} m³</Td>
            <Td numeric>{Math.round(row.weight)} kg</Td>
          </Tr>
        ))}
      </DataTable>
    </section>
  );
}

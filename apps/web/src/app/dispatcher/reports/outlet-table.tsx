import type { components } from "@katapatha/contracts/types";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { BrandPill } from "@/components/ui/status-pill";
import { MeterBar } from "./charts/meter-bar";
import { countText, deltaMinutesText, outletLabel, pctText, DASH } from "./report-format";

type Outlet = components["schemas"]["OutletPerformance"];

/**
 * Outlet performance, for the overview's top six and the Outlets tab's full
 * list. `orders` and `discrepancies` are null for an outlet seen only in the
 * historical legs (they record visits, not orders), and null renders as a dash:
 * a 0 there would say "no discrepancies" about days that never recorded any.
 */
export function OutletTable({ outlets, withStops = false }: { outlets: Outlet[]; withStops?: boolean }) {
  return (
    <DataTable
      caption="Outlet performance"
      head={
        <tr>
          <Th>Outlet</Th>
          <Th>Brand</Th>
          {withStops ? <Th numeric>Stops</Th> : null}
          <Th numeric>Orders</Th>
          <Th>On-time</Th>
          {withStops ? <Th numeric>Late</Th> : null}
          <Th numeric>Discrepancies</Th>
          <Th numeric>Avg. arrival</Th>
        </tr>
      }
      cards={outlets.map((o) => (
        <RowCard key={o.outletId}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-ink">{outletLabel(o)}</p>
            {o.brand ? <BrandPill brand={o.brand} /> : null}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-24">
              <MeterBar value={o.onTimePct} label={`On-time ${pctText(o.onTimePct)}`} />
            </div>
            <span className="tabular text-sm font-semibold">{pctText(o.onTimePct)}</span>
            <span className="text-xs text-muted">on time</span>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <Fact label={withStops ? "Stops" : "Orders"} value={withStops ? String(o.stops) : countText(o.orders)} />
            <Fact label="Discrepancies" value={countText(o.discrepancies)} bad={(o.discrepancies ?? 0) > 0} />
            <Fact label="Avg. arrival" value={deltaMinutesText(o.avgArrivalDeltaMin)} />
          </dl>
        </RowCard>
      ))}
    >
      {outlets.map((o) => (
        <Tr key={o.outletId}>
          <Td>{outletLabel(o)}</Td>
          <Td>{o.brand ? <BrandPill brand={o.brand} /> : DASH}</Td>
          {withStops ? <Td numeric>{o.stops}</Td> : null}
          <Td numeric>{countText(o.orders)}</Td>
          <Td>
            <span className="flex items-center gap-2">
              <span className="w-16 shrink-0">
                <MeterBar value={o.onTimePct} label={`On-time ${pctText(o.onTimePct)}`} />
              </span>
              <span className="tabular w-12 text-right">{pctText(o.onTimePct)}</span>
            </span>
          </Td>
          {withStops ? <Td numeric>{o.late}</Td> : null}
          <Td numeric>
            <span className={(o.discrepancies ?? 0) > 0 ? "font-semibold text-bad-ink" : ""}>{countText(o.discrepancies)}</span>
          </Td>
          <Td numeric>{deltaMinutesText(o.avgArrivalDeltaMin)}</Td>
        </Tr>
      ))}
    </DataTable>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular font-semibold ${bad ? "text-bad-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

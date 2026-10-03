import Link from "next/link";
import { api } from "@/lib/api";
import { readError } from "../../api-errors";
import { CONDITION_HINT, CONDITION_LABEL } from "../../reasons";
import { fetchShortfallReasons } from "../../reasons.server";
import { TRIP_STATUS_LABEL, type TripStatus } from "../../wave";
import {
  canMarkReady,
  lineState,
  readinessDisabledReason,
  type LineState,
} from "../../line-state";
import { LineForm } from "./line-form";
import { ReadinessForm } from "./readiness-form";

export const dynamic = "force-dynamic";

type Params = Promise<{ tripId: string }>;

type Line = {
  orderId: string;
  orderRef: string;
  outletId: string;
  seq: number;
  expectedUnits: number;
  loadedUnits?: number | null;
  condition?: "OK" | "SHORT" | "DAMAGED" | "MISSING" | null;
};

export default async function TripLoadListPage({ params }: { params: Params }) {
  const { tripId } = await params;

  const client = await api();
  const result = await client.GET("/trips/{tripId}/load-list", {
    params: { path: { tripId } },
  });

  if (result.error || !result.data) {
    const error = readError(result.response.status, "trip");
    return (
      <TripError
        tripId={tripId}
        title={error.title}
        detail={error.detail}
        expired={error.expired}
      />
    );
  }

  const { lines, status } = result.data;
  const total = lines.length;
  const checked = lines.filter((line) => line.loadedUnits != null && line.condition != null).length;
  const openDiscrepancies = lines.filter(
    (line) => line.condition != null && line.condition !== "OK",
  ).length;
  const everyLineChecked = total > 0 && checked === total;
  const readinessContext = { total, checked, openDiscrepancies, status };
  const ready = canMarkReady(readinessContext);

  const { reasons, fallback: reasonsFromFallback } = await fetchShortfallReasons();

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/loader" className="hover:underline">
          Dock board
        </Link>
        <span aria-hidden> › </span>
        <span className="text-ink">Trip load list</span>
      </nav>

      <header className="mt-3 flex flex-col gap-3 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">
            Load last delivery first
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Lines appear in <strong className="font-semibold text-ink">reverse delivery order</strong>. The row marked
            <span className="mx-1 inline-flex items-center rounded-md border border-[color:var(--c-navy)] bg-[color:var(--c-navy)] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
              Last stop
            </span>
            is where the driver will finish, so it has to go in first. Work top to bottom.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <section
        aria-label="Checklist progress"
        className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ProgressCard label="Lines" value={`${total}`} detail="On this trip." />
        <ProgressCard
          label="Checked"
          value={`${checked} / ${total}`}
          detail={
            everyLineChecked ? "Every line has been recorded." : "Record every line before marking ready."
          }
        />
        <ProgressCard
          label="Discrepancies"
          value={`${openDiscrepancies}`}
          detail={
            openDiscrepancies === 0
              ? "No shortfalls recorded."
              : "Shortfalls still block departure until resolved."
          }
        />
        <ProgressCard
          label="Ready?"
          value={ready ? "Can release" : "Not yet"}
          detail={
            ready
              ? "All lines OK. The vehicle is ready to depart."
              : status !== "PLANNED"
                ? "This trip has already moved past loading."
                : "Resolve open items first."
          }
        />
      </section>

      {reasonsFromFallback && (
        <p
          role="status"
          className="mt-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Reason list is temporarily unreachable; the dock terminal is using a local fallback. Reload the page once the
          network returns to pick up any updates.
        </p>
      )}

      {total === 0 ? (
        <EmptyList />
      ) : (
        <>
          <section aria-labelledby="line-heading" className="mt-6">
            <h2 id="line-heading" className="sr-only">
              Load lines grouped by outlet, in reverse delivery order
            </h2>
            <ol className="flex flex-col gap-5">
              {groupByOutlet(lines).map((group, groupIndex) => {
                const groupTotal = group.lines.reduce((s, l) => s + l.expectedUnits, 0);
                const groupLoaded = group.lines.reduce(
                  (s, l) => s + (l.loadedUnits ?? 0),
                  0,
                );
                const allChecked = group.lines.every(
                  (l) => l.loadedUnits != null && l.condition != null,
                );
                return (
                  <li key={group.outletId}>
                    <OutletGroup
                      index={groupIndex + 1}
                      outletId={group.outletId}
                      lineCount={group.lines.length}
                      loaded={groupLoaded}
                      expected={groupTotal}
                      allChecked={allChecked}
                      isLastStop={groupIndex === 0}
                    >
                      <ol className="flex flex-col gap-3">
                        {group.lines.map((line) => (
                          <LineRow
                            key={line.orderId}
                            tripId={tripId}
                            line={line}
                            reasons={reasons}
                            isLastStop={false}
                          />
                        ))}
                      </ol>
                    </OutletGroup>
                  </li>
                );
              })}
            </ol>
          </section>

          <ReadinessForm
            tripId={tripId}
            canMarkReady={ready}
            disabledReason={readinessDisabledReason(readinessContext)}
            initial={{ tripId }}
          />
        </>
      )}
    </main>
  );
}

type GroupedOutlet = { outletId: string; lines: Line[] };

function groupByOutlet(lines: Line[]): GroupedOutlet[] {
  const map = new Map<string, Line[]>();
  for (const line of lines) {
    if (!map.has(line.outletId)) map.set(line.outletId, []);
    map.get(line.outletId)!.push(line);
  }
  // Insertion order of Map is the order of first occurrence, which preserves
  // the reverse-delivery order the API already applied (first group = last
  // stop = load first).
  return Array.from(map.entries()).map(([outletId, items]) => ({ outletId, lines: items }));
}

function OutletGroup({
  index,
  outletId,
  lineCount,
  loaded,
  expected,
  allChecked,
  isLastStop,
  children,
}: {
  index: number;
  outletId: string;
  lineCount: number;
  loaded: number;
  expected: number;
  allChecked: boolean;
  isLastStop: boolean;
  children: React.ReactNode;
}) {
  const pct = expected > 0 ? Math.round((loaded / expected) * 100) : 0;
  return (
    <section className={`rounded-[var(--radius-card)] border bg-surface p-4 sm:p-5 ${isLastStop ? "border-[color:var(--c-navy)]" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-start gap-3">
          <span className={`tabular inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isLastStop ? "bg-[color:var(--c-navy)] text-white" : "bg-raised text-ink"}`}>
            {index}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-ink">{outletId}</h3>
              {isLastStop && (
                <span className="inline-flex items-center rounded-md bg-[color:var(--c-navy)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  Load first · last stop
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {lineCount} {lineCount === 1 ? "order" : "orders"} · {expected} units
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`tabular inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${allChecked ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-amber-50 text-amber-900 border border-amber-200"}`}>
            {allChecked ? "✓ Loaded" : "In progress"} {loaded} / {expected}
          </span>
          <div className="h-1 w-28 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-action" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProgressCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </article>
  );
}

function LineRow({
  tripId,
  line,
  reasons,
  isLastStop,
}: {
  tripId: string;
  line: Line;
  reasons: string[];
  isLastStop: boolean;
}) {
  const state = lineState(line);
  const style = LINE_STYLE[state];

  return (
    <li
      className={`rounded-[var(--radius-card)] border bg-surface p-4 ${style.border}`}
      data-state={state}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {isLastStop && (
              <span className="inline-flex items-center rounded-md bg-[color:var(--c-navy)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                Load first · last stop
              </span>
            )}
            <span>Delivery seq {line.seq} · {line.outletId}</span>
          </p>
          <p className="truncate text-lg font-semibold text-ink">{line.orderRef}</p>
          <p className="tabular text-sm text-muted">
            Expected <span className="font-semibold text-ink">{line.expectedUnits}</span> units
          </p>
        </div>
        <LineStateBadge state={state} />
      </div>

      {line.condition && line.loadedUnits != null ? (
        <p className="mt-3 text-sm text-muted">
          Last check:{" "}
          <span className="font-semibold text-ink">
            {CONDITION_LABEL[line.condition]} · {line.loadedUnits} loaded
          </span>
          {line.condition !== "OK" && (
            <span> — resolve or correct this line before marking the trip ready.</span>
          )}
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Not yet checked. Record the loaded units and condition below.
        </p>
      )}

      <p className="sr-only">{CONDITION_HINT[line.condition ?? "OK"]}</p>

      <LineForm tripId={tripId} line={line} reasons={reasons} />
    </li>
  );
}

const LINE_STYLE: Record<LineState, { border: string; pill: string; dot: string; label: string }> = {
  unchecked: {
    border: "border-line",
    pill: "border border-line bg-raised text-ink",
    dot: "bg-muted",
    label: "Unchecked",
  },
  ok: {
    border: "border-emerald-200",
    pill: "border border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-600",
    label: "Loaded",
  },
  discrepancy: {
    border: "border-amber-300",
    pill: "border border-amber-300 bg-amber-50 text-amber-900",
    dot: "bg-action",
    label: "Discrepancy",
  },
  blocked: {
    border: "border-red-300",
    pill: "border border-red-300 bg-red-50 text-critical",
    dot: "bg-critical",
    label: "Blocked",
  },
};

function LineStateBadge({ state }: { state: LineState }) {
  const style = LINE_STYLE[state];
  return (
    <span
      aria-label={`State: ${style.label}`}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${style.pill}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function StatusBadge({ status }: { status: TripStatus }) {
  return (
    <span
      aria-label={`Trip status: ${TRIP_STATUS_LABEL[status]}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-ink"
    >
      <span aria-hidden className="size-2 rounded-full bg-[color:var(--c-navy)]" />
      {TRIP_STATUS_LABEL[status]}
    </span>
  );
}

function EmptyList() {
  return (
    <section className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold text-ink">Nothing to load</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
        This trip has no lines. The dispatcher may still be publishing the plan, or every order on it has been deferred.
      </p>
    </section>
  );
}

function TripError({
  title,
  detail,
  expired,
}: {
  tripId: string;
  title: string;
  detail: string;
  expired: boolean;
}) {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/loader" className="hover:underline">
          Dock board
        </Link>
        <span aria-hidden> › </span>
        <span className="text-ink">Trip load list</span>
      </nav>
      <section
        role={expired ? "status" : "alert"}
        aria-live="polite"
        className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6"
      >
        <h1 className="text-2xl font-semibold text-critical">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">{detail}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/loader"
            className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
          >
            Dock board
          </Link>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { readOf } from "@/lib/read-result";
import { prepare, signInIfExpired } from "../load";
import { OutletTable } from "../outlet-table";
import { ReportCard, ReportError, ReportFrame } from "../report-frame";
import { reportHref } from "../report-params";

export const metadata = { title: "Outlet reports · Katapatha" };

const HERE = "/dispatcher/reports/outlets";
const SORTS = [
  { key: "stops", label: "Busiest" },
  { key: "onTime", label: "Worst on-time" },
  { key: "discrepancies", label: "Most discrepancies" },
] as const;

export default async function OutletsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { params, requested, client } = await prepare(searchParams, HERE);
  const asked = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const sort = SORTS.find((s) => s.key === asked)?.key ?? "stops";
  const result = await readOf(client.GET("/reports/outlets", { params: { query: { ...requested, sort } } }));
  signInIfExpired(result, HERE);

  if (!result.ok) {
    return (
      <ReportFrame active="outlets" requested={requested} shown={requested} keep={{ sort }}>
        <ReportError failure={result} what="the outlets report" />
      </ReportFrame>
    );
  }

  const r = result.data;
  return (
    <ReportFrame active="outlets" requested={requested} shown={{ from: r.from, to: r.to }} keep={{ sort }} source={r}>
      <ReportCard
        title="Outlet performance"
        subtitle={`${r.outlets.length} outlets with a stop in the range`}
        aside={
          <nav aria-label="Sort outlets" className="flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <Link
                key={s.key}
                href={reportHref(HERE, requested, { sort: s.key })}
                aria-current={s.key === sort ? "true" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${
                  s.key === sort ? "border-rail bg-rail text-white" : "border-line bg-surface text-ink hover:bg-raised"
                }`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        }
      >
        {r.outlets.length ? <OutletTable outlets={r.outlets} withStops /> : <EmptyState title="No outlet had a stop in this range" />}
        {r.notes.map((note) => (
          <p key={note} className="mt-3 text-xs text-muted">
            {note}
          </p>
        ))}
      </ReportCard>
    </ReportFrame>
  );
}

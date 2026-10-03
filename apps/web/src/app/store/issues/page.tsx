import type { Metadata } from "next";
import Link from "next/link";
import { newIdempotencyKey } from "@katapatha/api-client/idempotency";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { readFailure } from "@/lib/failures";
import { agoFrom, plural } from "@/lib/format";
import { StatusPill } from "@/components/ui/status-pill";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import {
  DEFAULT_KINDS,
  DEFAULT_REASONS,
  describeIssue,
  issueChoices,
  issueStatusLabel,
  issueStatusTone,
  reportableOrders,
} from "../issue-view";
import { goodsLabel, storeState, storeStateLabel } from "../order-state";
import { IssueForm } from "./issue-form";

export const metadata: Metadata = { title: "Report an issue · Katapatha" };
export const dynamic = "force-dynamic";

export default async function ReportIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; sent?: string }>;
}) {
  await requireRole("STORE_MANAGER", "/store/issues");
  const query = await searchParams;
  const client = await api();
  const [orders, issues, vocabularies] = await Promise.all([
    client.GET("/orders"),
    client.GET("/issues"),
    client.GET("/reference/vocabularies").catch(() => null),
  ]);

  if (orders.error || !orders.data) {
    const failure = readFailure(orders.response.status, "your deliveries");
    return (
      <PageBody>
        <PageHeader title="Report an issue" />
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome={failure.outcome}
          action={<ButtonLink href="/store/issues" variant="primary">Try again</ButtonLink>}
        />
      </PageBody>
    );
  }

  const choices = issueChoices(
    vocabularies?.data?.storeProblemKinds ?? DEFAULT_KINDS,
    vocabularies?.data?.storeIssueReasons ?? DEFAULT_REASONS,
  );
  const reportable = reportableOrders(orders.data)
    .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate) || b.ref.localeCompare(a.ref))
    .map((order) => ({
      id: order.id,
      ref: order.ref,
      units: order.units,
      summary: `${goodsLabel(order.tempRequirement)} · ${plural(order.units, "unit")} · ${storeStateLabel(storeState(order)).toLowerCase()}, ${shortDate(order.requestedDate)}`,
    }));
  const list = issues.data ?? [];
  // Believe `sent` only if the issue is really in the list; a made-up URL says nothing.
  const sent = query.sent ? list.find((issue) => issue.id === query.sent) : undefined;

  return (
    <PageBody>
      <PageHeader title="Report an issue" subtitle="Tell dispatch what went wrong. Your report stays attached to the delivery." />

      {sent ? (
        <p role="status" className="rounded-card border border-good/25 bg-good-surface px-4 py-3 text-sm text-ink">
          <span className="font-bold text-good-ink">Report sent.</span> {describeIssue(sent)} on {sent.orderRef} is with dispatch and shows below as{" "}
          {issueStatusLabel(sent.status).toLowerCase()}.
        </p>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="New report" className="rounded-card border border-line bg-surface p-4 sm:p-5">
          {reportable.length === 0 ? (
            <EmptyState
              title="No delivery to report on yet"
              detail="You can report an issue about an order that is on the way or has been delivered."
              action={<ButtonLink href="/store/orders">Open my orders</ButtonLink>}
            />
          ) : (
            <IssueForm
              choices={choices}
              orders={reportable}
              clientRequestId={newIdempotencyKey()}
              initialOrderId={query.order ?? null}
            />
          )}
        </section>

        <div className="flex flex-col gap-5">
          <section aria-labelledby="next-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="next-heading" className="text-lg font-bold text-ink">What happens next</h2>
            <ol className="mt-3 flex flex-col gap-3 text-sm">
              <li><span className="font-semibold text-ink">Dispatch is notified.</span> <span className="text-muted">Your report appears in their Exceptions list as soon as you send it.</span></li>
              <li><span className="font-semibold text-ink">Dispatch picks it up.</span> <span className="text-muted">The status below changes from Open to Dispatch has it.</span></li>
              <li><span className="font-semibold text-ink">It is resolved with a note.</span> <span className="text-muted">You will see dispatch&apos;s note here.</span></li>
            </ol>
          </section>

          <section aria-labelledby="recent-heading" className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <h2 id="recent-heading" className="text-lg font-bold text-ink">Your issues</h2>
            {issues.error ? (
              <p className="mt-2 text-sm text-muted">Your earlier reports could not be loaded. Reload to try again.</p>
            ) : list.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing reported yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {list.map((issue) => (
                  <li key={issue.id} className="rounded-control border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-ink">{describeIssue(issue)}</p>
                      <StatusPill label={issueStatusLabel(issue.status)} tone={issueStatusTone(issue.status)} />
                    </div>
                    <p className="mt-0.5 text-muted">
                      <Link href={`/store/orders/${issue.orderId}`} className="font-mono font-semibold text-link hover:underline">{issue.orderRef}</Link>
                      {issue.units ? ` · ${plural(issue.units, "unit")}` : ""} · {agoFrom(issue.createdAt)}
                    </p>
                    {issue.note ? <p className="mt-1 text-ink">{issue.note}</p> : null}
                    {issue.resolution ? <p className="mt-1 text-muted">Dispatch: {issue.resolution}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PageBody>
  );
}

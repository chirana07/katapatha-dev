import Link from "next/link";

export const metadata = {
  title: "Report an issue · Katapatha",
};

export default function ReportIssuePage() {
  return (
    <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-2 border-b border-line pb-5">
        <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Report an issue</h1>
        <p className="max-w-xl text-sm text-muted">
          For today, raising an issue happens on the specific delivery. Open the order, select
          <span className="font-semibold text-ink"> Report shortfall</span>, and record what
          happened at receipt. The dispatcher sees it alongside the delivery event.
        </p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <article className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Common issues</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-ink">
            <li className="flex items-start gap-2"><span aria-hidden className="mt-1 size-1.5 rounded-full bg-action" />Short delivery — fewer units arrived than expected.</li>
            <li className="flex items-start gap-2"><span aria-hidden className="mt-1 size-1.5 rounded-full bg-action" />Damaged items — product arrived unusable.</li>
            <li className="flex items-start gap-2"><span aria-hidden className="mt-1 size-1.5 rounded-full bg-action" />Missed window — vehicle arrived outside the receiving window.</li>
            <li className="flex items-start gap-2"><span aria-hidden className="mt-1 size-1.5 rounded-full bg-action" />Wrong order — items that were not on the request.</li>
          </ul>
        </article>
        <article className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Where to start</p>
          <p className="mt-3 text-sm text-muted">
            Each issue is scoped to a specific order so dispatch can act on the exact delivery.
            Open the order from My orders and record the shortfall on its receipt panel.
          </p>
          <Link
            href="/store"
            className="mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
          >
            Open my orders →
          </Link>
        </article>
      </section>

      <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-raised p-4 text-sm text-muted">
        <p className="font-semibold text-ink">Need to speak to someone?</p>
        <p className="mt-1">
          Contact your dispatcher at the depot directly. Issues you record on an order&apos;s
          receipt panel are saved on that order&apos;s record.
        </p>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";

export default function DriverError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-4">
      <section className="rounded-[var(--radius-card)] bg-red-50 p-5">
        <h1 className="text-xl font-semibold text-critical">Driver workspace unavailable</h1>
        <p className="mt-2 text-sm text-muted">
          Katapatha could not finish loading this page. Any events already saved for this stop remain recorded. Reload
          the run before trying the action again.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 min-w-32 rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
          >
            Try again
          </button>
          <Link
            href="/driver"
            className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface px-4 font-semibold text-ink"
          >
            Today&apos;s run
          </Link>
        </div>
      </section>
    </main>
  );
}

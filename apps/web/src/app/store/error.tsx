"use client";

import Link from "next/link";

export default function StoreError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <section className="rounded-[var(--radius-card)] bg-red-50 p-5 sm:p-6">
        <h1 className="text-xl font-semibold text-critical">Store workspace unavailable</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Katapatha could not finish loading this page. Your submitted order or receipt may still have been recorded, so check the order list before trying the action again.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink transition-[filter] hover:brightness-95"
          >
            Try again
          </button>
          <Link
            href="/store"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 font-semibold text-ink"
          >
            Check order list
          </Link>
        </div>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";

export default function LoaderError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <section className="rounded-[var(--radius-card)] bg-red-50 p-5 sm:p-6">
        <h1 className="text-xl font-semibold text-critical">Loader workspace unavailable</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Katapatha could not finish loading this page. Any load checks that
          were saved before the error remain recorded. Reload the dock board
          before retrying.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 min-w-28 rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink transition-[filter] hover:brightness-95"
          >
            Try again
          </button>
          <Link
            href="/loader"
            className="inline-flex min-h-11 min-w-28 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface px-4 font-semibold text-ink"
          >
            Dock board
          </Link>
        </div>
      </section>
    </main>
  );
}

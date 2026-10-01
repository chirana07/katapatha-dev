export default function DispatcherPage() {
  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Daily operations</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Planning desk</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Close today&apos;s order queue, build the delivery plan, resolve deferrals, and publish the run.
        </p>
      </header>

      <section className="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-muted">Next step</p>
            <h2 className="mt-1 text-xl font-semibold">Review today&apos;s order queue</h2>
            <p className="mt-2 max-w-2xl text-muted">
              Confirm the queued orders and cutoff time before building today&apos;s delivery plan.
            </p>
          </div>
          <span className="rounded-md bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800">Setup ready</span>
        </div>
      </section>
    </main>
  );
}

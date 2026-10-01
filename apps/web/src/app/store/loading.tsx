export default function StoreLoading() {
  return (
    <main className="mx-auto w-full max-w-7xl animate-pulse p-4 sm:p-6" aria-busy="true">
      <span className="sr-only">Loading Store workspace</span>
      <div className="h-5 w-28 rounded bg-line" />
      <div className="mt-4 h-9 w-52 rounded bg-line" />
      <div className="mt-3 h-5 w-full max-w-md rounded bg-line" />
      <section aria-hidden className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </section>
      <div aria-hidden className="mt-8 h-12 w-full rounded-[var(--radius-control)] bg-line" />
      <section aria-hidden className="mt-5 space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-32 rounded-[var(--radius-card)] bg-surface md:h-16" />
        ))}
      </section>
    </main>
  );
}

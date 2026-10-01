export default function DriverLoading() {
  return (
    <main className="mx-auto w-full max-w-xl animate-pulse p-4" aria-busy="true">
      <span className="sr-only">Loading driver run</span>
      <div className="h-5 w-28 rounded bg-line" />
      <div className="mt-3 h-9 w-56 rounded bg-line" />
      <div className="mt-2 h-4 w-full max-w-sm rounded bg-line" />
      <section aria-hidden className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-28 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </section>
    </main>
  );
}

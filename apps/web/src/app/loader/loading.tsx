export default function LoaderLoading() {
  return (
    <main className="mx-auto w-full max-w-7xl animate-pulse p-4 sm:p-6" aria-busy="true">
      <span className="sr-only">Loading dock board</span>
      <div className="h-5 w-32 rounded bg-line" />
      <div className="mt-3 h-9 w-64 rounded bg-line" />
      <div className="mt-2 h-5 w-full max-w-md rounded bg-line" />
      <section aria-hidden className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-40 rounded-[var(--radius-card)] bg-surface" />
        ))}
      </section>
    </main>
  );
}

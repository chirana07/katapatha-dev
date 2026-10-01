const STEPS = [
  { key: "queued", label: "Order queued" },
  { key: "planned", label: "Delivery planned" },
  { key: "on_the_way", label: "On the way" },
  { key: "delivered", label: "Delivered" },
] as const;

export function OrderProgress({ state }: { state: string }) {
  if (state === "deferred" || state === "failed" || state === "cancelled") {
    return (
      <section aria-labelledby="progress-heading" className="mt-6 rounded-[var(--radius-card)] bg-red-50 p-5">
        <h2 id="progress-heading" className="font-semibold text-critical">
          {state === "deferred"
            ? "Delivery deferred"
            : state === "failed"
              ? "Delivery failed"
              : "Order cancelled"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Dispatch must update this order before delivery can continue.
        </p>
      </section>
    );
  }

  const activeIndex = Math.max(0, STEPS.findIndex((step) => step.key === state));

  return (
    <section aria-labelledby="progress-heading" className="mt-6 rounded-[var(--radius-card)] bg-surface p-5 sm:p-6">
      <h2 id="progress-heading" className="text-lg font-semibold">Delivery progress</h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-4">
        {STEPS.map((step, index) => {
          const complete = index <= activeIndex;
          const current = index === activeIndex;
          return (
            <li key={step.key} aria-current={current ? "step" : undefined} className="flex items-center gap-3 sm:block">
              <span
                aria-hidden
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  complete ? "bg-action text-ink" : "bg-raised text-muted"
                }`}
              >
                {index + 1}
              </span>
              <span className={`text-sm sm:mt-2 sm:block ${current ? "font-semibold text-ink" : "text-muted"}`}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

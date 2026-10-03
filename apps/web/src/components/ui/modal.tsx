"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * The dialog.
 *
 * Built on <dialog showModal()> rather than a hand-rolled overlay, so focus
 * trapping, Esc, inertness of the page behind and the top layer all come from
 * the platform instead of from code we would have to keep correct.
 *
 * DESIGN.md allows one restrained shadow for an elevated panel; this is it.
 * Motion is a short fade that `prefers-reduced-motion` already disables
 * globally in tokens.css.
 */
export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  context,
  children,
  footer,
  /** Widen for side-by-side content such as the defer-order impact list. */
  wide,
}: {
  open: boolean;
  onClose: () => void;
  /** Small caps label above the title: "PUBLISH PLAN", "DEFER ORDER". */
  eyebrow?: string;
  title: string;
  /** One line of identifying detail under the title. */
  context?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // `cancel` is Esc; `close` covers the form-method=dialog path. Both have
      // to tell the owner, or the dialog reopens on the next render.
      onCancel={onClose}
      onClose={onClose}
      // The backdrop is a click target for dismissal, so a click that lands on
      // the dialog itself must not bubble out and close it.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100vw-2rem)] rounded-card-loose border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40 ${
        wide ? "max-w-3xl" : "max-w-xl"
      }`}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-xs font-bold uppercase tracking-wider text-action">{eyebrow}</p>
            ) : null}
            <h2 id={titleId} className="mt-1 text-xl font-bold tracking-tight">
              {title}
            </h2>
            {context ? <p className="mt-1 text-sm text-muted">{context}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
          >
            <span aria-hidden>&times;</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/**
 * "What happens when you confirm."
 *
 * The product's signature move, and the reason the dialog component exists at
 * all: publishing a plan, deferring an order and applying a shortfall decision
 * each reach three other roles, and the designs name every one of them before
 * the operator commits. A confirmation that only says "Are you sure?" is the
 * thing this replaces.
 */
export function Consequences({
  title = "What happens when you confirm",
  items,
}: {
  title?: string;
  items: { who: string; detail: ReactNode }[];
}) {
  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
      <ol className="mt-3 flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.who} className="flex gap-3">
            <span
              aria-hidden
              className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-rail text-xs font-bold text-white"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{item.who}</p>
              <p className="text-sm text-muted">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * The right-hand drawer (the designs' "Defer order").
 *
 * Same construction as Modal — a native <dialog> opened with showModal(), so
 * focus trapping, Esc and the inert page behind come from the platform — but
 * anchored to the right edge and full height, because the defer decision needs
 * the plan still visible next to it.
 *
 * It is URL-driven rather than state-driven: the page renders it only while a
 * search param asks for it, and closing is a navigation to `closeHref`. That
 * keeps the open drawer linkable and lets a server action reopen it with the
 * dispatcher's choice and an error still in place. Because it is only rendered
 * while open, a redirect that drops the param unmounts it without a stray
 * close event rewriting the URL.
 */
export function SideDrawer({
  closeHref,
  eyebrow,
  title,
  context,
  children,
  footer,
}: {
  closeHref: string;
  /** Small caps label above the title: "DEFER ORDER". */
  eyebrow?: string;
  title: string;
  context?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // A modal dialog does not stop the page behind it from scrolling.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const close = () => router.replace(closeHref, { scroll: false });

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={close}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-[540px] rounded-none border-l border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            {eyebrow ? <p className="text-xs font-bold uppercase tracking-wider text-action">{eyebrow}</p> : null}
            <h2 id={titleId} className="mt-1 text-xl font-bold tracking-tight">
              {title}
            </h2>
            {context ? <p className="mt-1 text-sm text-muted">{context}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
          >
            <span aria-hidden>&times;</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-line bg-raised px-5 py-4">{footer}</div> : null}
      </div>
    </dialog>
  );
}

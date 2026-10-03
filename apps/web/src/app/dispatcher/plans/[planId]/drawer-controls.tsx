"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keyboard behaviour for the URL-driven defer drawer: focus lands on the
 * panel when it opens, Tab stays inside it, and Escape closes it. The drawer itself is server
 * rendered; this is the only client piece it needs.
 */
export function DrawerControls({ closeHref, labelledBy }: { closeHref: string; labelledBy: string }) {
  const router = useRouter();

  useEffect(() => {
    const title = document.getElementById(labelledBy);
    const dialog = title?.closest<HTMLElement>("[role=dialog]") ?? null;
    title?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        router.replace(closeHref, { scroll: false });
        return;
      }
      // Keep Tab inside the dialog; aria-modal alone doesn't stop focus from
      // walking into the page behind the overlay.
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === title)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeHref, labelledBy, router]);

  return null;
}

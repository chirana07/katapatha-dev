"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keyboard behaviour for the URL-driven defer drawer: focus lands on the
 * panel when it opens and Escape closes it. The drawer itself is server
 * rendered; this is the only client piece it needs.
 */
export function DrawerControls({ closeHref, labelledBy }: { closeHref: string; labelledBy: string }) {
  const router = useRouter();

  useEffect(() => {
    document.getElementById(labelledBy)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.replace(closeHref, { scroll: false });
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

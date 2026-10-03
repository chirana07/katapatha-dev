"use client";

import { useEffect } from "react";
import { writeSaved } from "./basket-storage";

/**
 * The order is placed, so the basket that was waiting out a reload is spent.
 * Mounted by the confirmed page, which is only reached after the API accepted
 * the order; clearing it any earlier would lose the choices of a manager whose
 * request failed.
 */
export function ClearSavedBasket() {
  useEffect(() => {
    writeSaved({});
  }, []);
  return null;
}

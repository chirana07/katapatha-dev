/**
 * Pure helpers behind the UI primitives. No React, no React Native: vitest runs
 * in Node here, and logic that sat inside a .tsx file could not be tested.
 */

// --- the three-step stop flow (Check items -> Receipt -> Confirm) -------------

export type StepNumber = 1 | 2 | 3;
export type StepValue = StepNumber | "done";
export type TrackerState = "done" | "current" | "todo";

export const DEFAULT_STEP_LABELS = ["Check items", "Receipt", "Confirm"] as const;
export type StepLabels = readonly [string, string, string];

/** Step N is current; earlier steps are done; later ones are todo. "done" = all three done. */
export function stepTrackerState(step: StepValue): readonly [TrackerState, TrackerState, TrackerState] {
  if (step === "done") return ["done", "done", "done"];
  const state = (index: number): TrackerState =>
    index + 1 < step ? "done" : index + 1 === step ? "current" : "todo";
  return [state(0), state(1), state(2)];
}

/** The badge at the right of the stop header: "Step 2 of 3", or "Done". */
export function stepBadgeLabel(step: StepValue): string {
  return step === "done" ? "Done" : `Step ${step} of 3`;
}

// --- progress -----------------------------------------------------------------

/** Whole percent, clamped to 0-100. No stops -> 0, never NaN. */
export function progressPercent(done: number, total: number): number {
  if (!(total > 0) || !(done > 0)) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

/** "1 of 4 stops completed". */
export function progressLabel(done: number, total: number): string {
  return `${done} of ${total} ${total === 1 ? "stop" : "stops"} completed`;
}

// --- counting (Stepper) -------------------------------------------------------

/** Moves a count by `delta`, held within [min, max]. */
export function nudgeCount(value: number, delta: number, min: number, max?: number): number {
  const next = value + delta;
  if (next < min) return min;
  if (max !== undefined && next > max) return max;
  return next;
}

/**
 * A typed count, held within [min, max]. Null when the text is not a whole
 * number (empty, a minus sign, letters, a decimal), so the caller can keep the
 * previous value instead of recording a figure the driver did not type.
 */
export function parseCount(raw: string, min: number, max?: number): number | null {
  const text = raw.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  return nudgeCount(Number(text), 0, min, max);
}

// --- chrome insets ------------------------------------------------------------

/**
 * Space the app must leave itself under the status bar and above the system
 * navigation, WITHOUT react-native-safe-area-context (it is not resolvable from
 * apps/mobile; only expo-router's own copy is). On Android the status bar height
 * is exact (StatusBar.currentHeight); the bottom value is a conservative
 * allowance for the gesture handle or 3-button bar, not a measurement. iOS is a
 * conservative notch/island allowance: this app ships on Android only
 * (docs/ARCHITECTURE.md).
 */
export function computeInsets(
  os: string,
  statusBarHeight: number | undefined,
): { top: number; bottom: number } {
  if (os === "android") return { top: Math.max(statusBarHeight ?? 0, 24), bottom: 12 };
  return { top: 54, bottom: 20 };
}

// --- stop badges --------------------------------------------------------------

export type StopBadgeKind =
  | "delivered"
  | "next"
  | "upcoming"
  | "saved"
  | "onsite"
  | "failed"
  | "skipped";

/**
 * "saved" has no default label ON PURPOSE: wording about what is stored on the
 * phone is routed through src/outbox/claims.ts (docs/DESIGN.md), so the screen
 * passes it in rather than this file owning a claim.
 */
export const STOP_BADGE_SPEC: Record<
  StopBadgeKind,
  { label: string | null; tone: "good" | "accent" | "neutral" | "warn" | "bad"; icon: "check" | "phone" | "warning" | null }
> = {
  delivered: { label: "Delivered", tone: "good", icon: null },
  next: { label: "Next stop", tone: "accent", icon: null },
  upcoming: { label: "Upcoming", tone: "neutral", icon: null },
  saved: { label: null, tone: "warn", icon: "phone" },
  onsite: { label: "On site", tone: "accent", icon: null },
  failed: { label: "Failed", tone: "bad", icon: "warning" },
  skipped: { label: "Skipped", tone: "neutral", icon: null },
};

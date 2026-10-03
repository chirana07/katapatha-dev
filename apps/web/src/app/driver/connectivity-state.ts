import { clockTime } from "../../lib/format";

/**
 * What the driver page knows about its own connection, as a pure state machine.
 *
 * The web driver is a fallback with NO offline durability: it has no outbox, so
 * a delivery tapped while offline goes nowhere. Everything here exists to say
 * that plainly and to stop the driver from believing otherwise. DESIGN.md's
 * connectivity labels are `Checking`, `Connected`, `Offline`, decided by a real
 * request to the server, never by `navigator.onLine` alone.
 */
export type LinkStatus = "checking" | "connected" | "offline";

export interface ConnectivityState {
  status: LinkStatus;
  /** The last time a probe got an answer, ISO. Null when none has yet. */
  lastConnectedAt: string | null;
  /** When a probe first answered after being offline, ISO. Null otherwise. */
  backOnlineAt: string | null;
}

export const INITIAL_CONNECTIVITY: ConnectivityState = {
  status: "checking",
  lastConnectedAt: null,
  backOnlineAt: null,
};

export const LINK_LABEL: Record<LinkStatus, string> = {
  checking: "Checking",
  connected: "Connected",
  offline: "Offline",
};

/** How long the "Back online" notice stays after recovery. */
export const BACK_ONLINE_VISIBLE_MS = 2 * 60 * 1000;

export function applyProbe(state: ConnectivityState, reachable: boolean, nowIso: string): ConnectivityState {
  if (reachable) {
    return {
      status: "connected",
      lastConnectedAt: nowIso,
      // Only a recovery earns the notice; a first successful probe does not.
      backOnlineAt: state.status === "offline" ? nowIso : state.backOnlineAt,
    };
  }
  return { status: "offline", lastConnectedAt: state.lastConnectedAt, backOnlineAt: null };
}

/** Probe faster while offline so the driver is not left staring at a stale label. */
export function probeIntervalMs(status: LinkStatus): number {
  return status === "offline" ? 5_000 : 15_000;
}

/** A submit is blocked only when we have positive evidence of no connection. */
export function canSubmit(status: LinkStatus): boolean {
  return status !== "offline";
}

export function showBackOnline(state: ConnectivityState, nowMs: number): boolean {
  if (state.status !== "connected" || !state.backOnlineAt) return false;
  return nowMs - new Date(state.backOnlineAt).getTime() < BACK_ONLINE_VISIBLE_MS;
}

/** The sentence under the Offline banner. Never says anything was saved. */
export function offlineNotice(state: ConnectivityState): { title: string; detail: string } {
  const since = state.lastConnectedAt ? ` since ${clockTime(state.lastConnectedAt)}` : "";
  return {
    title: `No connection. Nothing recorded${since} reaches Katapatha until you are back online.`,
    detail:
      "This web page does not keep records on the phone, so keep it open and record each stop once the connection returns.",
  };
}

export function backOnlineNotice(state: ConnectivityState): { title: string; detail: string } {
  const at = state.backOnlineAt ? ` at ${clockTime(state.backOnlineAt)}` : "";
  return {
    title: `Back online${at}.`,
    detail: "Nothing was sent while you were offline. Check the stops below and record anything that is still missing.",
  };
}

/** The reason beside a disabled submit button. */
export const OFFLINE_SUBMIT_REASON = "No connection. This cannot be recorded until you are back online.";

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { clockTime } from "@/lib/format";
import { canSubmit } from "./connectivity-state";
import { useConnectivity } from "./connectivity";
import { generateUlid } from "./format";
import { reportPosition } from "./position-actions";
import { buildPingPayload, geolocationErrorCopy, shouldSendPing } from "./position-share";

/**
 * "Share my position", off until the driver turns it on.
 *
 * It lives in the layout so it survives moving between the run and a stop, but
 * it is still only a watch on an open page: closing or backgrounding the page
 * ends it, and the copy says exactly that. It reports the phone's own fix about
 * once a minute and dispatch shows it as "last reported", with its age.
 */
/** "idle" is on-but-no-answer-yet: the control shows it as looking for a fix. */
type Phase = "idle" | "sent" | "problem";

interface PositionState {
  on: boolean;
  phase: Phase;
  /** ISO time of the last fix dispatch confirmed receiving. */
  lastSentAt: string | null;
  problem: string | null;
  supported: boolean;
  setOn: (on: boolean) => void;
}

const PositionContext = createContext<PositionState | null>(null);

export function usePositionShare(): PositionState {
  const value = useContext(PositionContext);
  if (!value) throw new Error("usePositionShare must be used inside PositionShareProvider.");
  return value;
}

export function PositionShareProvider({ children }: { children: ReactNode }) {
  const [on, setOnState] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const connectivity = useConnectivity();
  const reachable = useRef(true);
  const online = canSubmit(connectivity.status);
  useEffect(() => {
    reachable.current = online;
  }, [online]);
  const lastAttemptMs = useRef<number | null>(null);
  const sending = useRef(false);

  // Server render assumes support; the browser answers for itself once hydrated.
  const supported = useSyncExternalStore(
    () => () => {},
    () => "geolocation" in navigator,
    () => true,
  );

  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    lastAttemptMs.current = null;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (sending.current || !shouldSendPing(lastAttemptMs.current, now)) return;
        if (!reachable.current) {
          setPhase("problem");
          setProblem("No connection, so this position was not sent. It will try again when you are back online.");
          return;
        }
        const clientPingId = generateUlid();
        // The fix's own timestamp is when the phone took it; a cached fix is older than "now".
        const takenAt = position.timestamp || now;
        if (!buildPingPayload(position.coords, takenAt, clientPingId)) return;
        sending.current = true;
        lastAttemptMs.current = now;
        void reportPosition({
          fix: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy },
          recordedAtMs: takenAt,
          clientPingId,
        })
          .then((result) => {
            if (result.ok) {
              setPhase("sent");
              setProblem(null);
              setLastSentAt(result.sentAt);
            } else {
              setPhase("problem");
              setProblem(result.error);
            }
          })
          .catch(() => {
            setPhase("problem");
            setProblem("Katapatha did not answer, so that position was not confirmed as sent.");
          })
          .finally(() => {
            sending.current = false;
          });
      },
      (error) => {
        setPhase("problem");
        setProblem(geolocationErrorCopy(error.code));
        // A refusal will not fix itself; keep the switch honest rather than "on" and silent.
        if (error.code === 1) setOnState(false);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on]);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    setPhase("idle");
    setProblem(null);
  }, []);

  return (
    <PositionContext.Provider value={{ on, phase, lastSentAt, problem, supported, setOn }}>
      {children}
    </PositionContext.Provider>
  );
}

/** The control on the run page. */
export function PositionShareCard() {
  const { on, phase, lastSentAt, problem, supported, setOn } = usePositionShare();

  return (
    <section aria-labelledby="share-heading" className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="share-heading" className="font-semibold text-ink">
            Share my position
          </h2>
          <p className="mt-1 text-sm text-muted">
            Sends your position to dispatch while this page is open. Dispatch sees it as &lsquo;last reported&rsquo;.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="share-heading"
          disabled={!supported}
          onClick={() => setOn(!on)}
          className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            on ? "border-action bg-action" : "border-line bg-raised"
          }`}
        >
          <span
            aria-hidden
            className={`absolute left-0.5 top-0.5 size-6 rounded-full bg-surface shadow transition-transform ${
              on ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {!supported ? (
        <p className="mt-3 text-sm text-muted">This browser cannot report a position.</p>
      ) : null}
      {on && phase === "idle" && !problem ? (
        <p role="status" className="mt-3 text-sm text-muted">Looking for a position fix…</p>
      ) : null}
      {on && phase === "sent" && lastSentAt ? (
        <p role="status" className="tabular mt-3 text-sm text-ink">
          Last sent {clockTime(lastSentAt)}. Dispatch sees this as the last reported position.
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 text-sm text-bad-ink">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** A small marker in the header while sharing is on, so it is never on without the driver seeing it. */
export function PositionSharingMarker() {
  const { on } = usePositionShare();
  if (!on) return null;
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white">
      <span aria-hidden className="size-2 rounded-full bg-action" />
      Sharing position
    </span>
  );
}

/**
 * The offline-durability claim gate.
 *
 * docs/PRODUCT.md: the interface "must not claim offline durability until the
 * outbox is implemented and verified". src/outbox/README.md names the test that
 * constitutes verification -- queue three events offline, drain, assert
 * accepted=3 duplicates=0, then replay the identical batch and assert
 * duplicates=3 -- and says plainly: "Do not claim offline durability in the UI
 * until that test passes."
 *
 * So the claim is one constant, flipped in the same pull request as the test
 * that earns it (src/outbox/drain.acceptance.test.ts). A reviewer sees the
 * promise and its evidence in one diff, and no screen can make the promise by
 * accident, because every screen reads its wording from here.
 *
 * Note what is still not claimed even when this is true: nothing says "syncs
 * automatically" or "in the background". Every drain is foreground-only -- no
 * background task is registered and expo-background-task is deliberately not a
 * dependency -- and docs/DESIGN.md forbids implying otherwise.
 */

/**
 * TRUE, earned by src/outbox/drain.acceptance.test.ts: three events queued while
 * the transport was failing drain as accepted=3, duplicates=0, and the identical
 * batch replayed reports duplicates=3 and changes nothing.
 *
 * What the evidence does and does not establish, stated plainly because the
 * claim rests on it:
 *
 *   IT PROVES the device side -- what the copy below claims. Events survive in
 *   SQLite across a failed send, the drain settles them, a replay is harmless,
 *   and a double-tap is a no-op. It runs against real SQLite and the real SQL,
 *   with a fake applier that behaves as the contract specifies.
 *
 *   THE SERVER SIDE is implemented (services/stopEvents.ts keys on the client's
 *   ULID; routes/sync.ts is real) and was exercised from this app's real drain
 *   and transport against the running API -- see src/outbox/README.md, "Verified
 *   against the API". It has still never run from a phone.
 *
 * The copy stays true under that gap: it says a record is kept on the phone and
 * sent when there is signal while the app is open. It does not say the app syncs
 * by itself, and it does not promise the server will deduplicate.
 */
export const OFFLINE_DURABILITY_VERIFIED = true;

/**
 * Every sentence the driver app uses about saving, waiting and sending.
 *
 * `claimsCopy(verified)` is the single place the gate is applied. The exported
 * functions below call it with OFFLINE_DURABILITY_VERIFIED; the tests call it
 * with both values, which is how the non-durable fallback stays honest even
 * while the constant is true. When the gate is false every sentence falls back
 * to the "recorded on this phone -- send before you close the app" family: it
 * claims nothing about the record surviving or being sent later.
 *
 * Two sentences are the same in both states and say so: "Sent" and the
 * "Back online" copy are claims about the SERVER having accepted a batch, which
 * is the only thing that makes them true, not claims about the phone.
 */
export function claimsCopy(verified: boolean) {
  const plural = (count: number, one: string, many: string) =>
    count === 1 ? `1 ${one}` : `${count} ${many}`;

  return {
    unsentCopy(count: number): string {
      const subject = plural(count, "record", "records");
      return verified
        ? `${subject} held on this phone. Sent when there is signal.`
        : `${subject} recorded on this phone. Not sent yet — tap Send when you have signal.`;
    },

    outboxExplainer(): string {
      return verified
        ? "Records are kept on this phone and sent while the app is open."
        : "Records are kept on this phone for now. Send them before you close the app.";
    },

    /** The banner under the header while the phone has no contact with the server. */
    lampBannerCopy(input: { lamp: boolean; sinceClock: string | null }): {
      title: string;
      body: string;
    } {
      const state = input.lamp ? "Lamp Mode is on" : "Offline";
      const since = input.sinceClock ? `no signal since ${input.sinceClock}` : "no signal";
      return {
        title: `${state} · ${since}`,
        body: verified
          ? "Keep working. Everything is saved on this phone."
          : "Keep working. Records are kept on this phone for now — send them before you close the app.",
      };
    },

    /** The footer on the Trip screen while records are waiting. */
    waitingFooterCopy(count: number): string {
      if (count <= 0) return "No updates waiting to send";
      const subject = plural(count, "update", "updates");
      return verified
        ? `${subject} waiting to send`
        : `${subject} recorded on this phone, not sent yet`;
    },

    /** The chip beside "Count with the store". Null while connected: nothing to say. */
    countStepStatusCopy(connected: boolean): string | null {
      if (connected) return null;
      return verified ? "Offline · saved on phone" : "Offline · not sent yet";
    },

    /** The line under the receipt photo button. */
    receiptStepHint(connected: boolean): string {
      if (verified) {
        return connected
          ? "No signal? The photo is saved on this phone and sent later."
          : "Offline · the photo is saved on this phone and sent when there is signal.";
      }
      return connected
        ? "No signal? The photo is recorded on this phone. Send it before you close the app."
        : "Offline · the photo is recorded on this phone, not sent. Send it before you close the app.";
    },

    /** The status chip on "Delivery recorded". */
    recordedStatusLabel(sent: boolean): string {
      if (sent) return "Sent";
      return verified ? "Saved on this phone" : "Recorded on this phone, not sent";
    },

    /** The notice on "Delivery recorded" while this stop's records have not been sent. */
    recordedWaitingNotice(input: { sinceClock: string | null; count: number }): {
      title: string;
      body: string;
    } {
      const since = input.sinceClock ? `No signal since ${input.sinceClock}` : "No signal";
      return {
        title: `${since} · ${plural(input.count, "update", "updates")} waiting`,
        body: verified
          ? "They are sent when there is signal, while the app is open. Nothing to re-enter."
          : "They are recorded on this phone, not sent. Send them from Unsent records before you close the app.",
      };
    },

    /**
     * The banner after a batch the server accepted. Only true because the server
     * accepted it, so it is the same in both gate states; the caller passes the
     * outlet it knows (null when the batch spanned several).
     */
    backOnlineCopy(input: { atClock: string; outletName: string | null }): {
      title: string;
      body: string;
    } {
      return {
        title: `Back online · sent at ${input.atClock}`,
        body: input.outletName
          ? `Dispatch and ${input.outletName} can now see your work.`
          : "Dispatch can now see your work.",
      };
    },

    /** The Trip footer once nothing is waiting after a send. */
    allSentFooterCopy(atClock: string | null): string {
      return atClock ? `All updates sent · ${atClock}` : "All updates sent";
    },

    /** The pill on a stop card whose records are on the phone only. */
    stopSavedPillLabel(): string {
      return verified ? "Saved on phone" : "Not sent";
    },
  };
}

const gated = () => claimsCopy(OFFLINE_DURABILITY_VERIFIED);

/** How the app describes an event that is recorded here but not yet sent. */
export const unsentCopy = (count: number): string => gated().unsentCopy(count);

/** The one-line explanation on the outbox screen. */
export const outboxExplainer = (): string => gated().outboxExplainer();

export const lampBannerCopy = (input: { lamp: boolean; sinceClock: string | null }) =>
  gated().lampBannerCopy(input);

export const waitingFooterCopy = (count: number): string => gated().waitingFooterCopy(count);

export const countStepStatusCopy = (connected: boolean): string | null =>
  gated().countStepStatusCopy(connected);

export const receiptStepHint = (connected: boolean): string => gated().receiptStepHint(connected);

export const recordedStatusLabel = (sent: boolean): string => gated().recordedStatusLabel(sent);

export const recordedWaitingNotice = (input: { sinceClock: string | null; count: number }) =>
  gated().recordedWaitingNotice(input);

export const backOnlineCopy = (input: { atClock: string; outletName: string | null }) =>
  gated().backOnlineCopy(input);

export const allSentFooterCopy = (atClock: string | null): string =>
  gated().allSentFooterCopy(atClock);

export const stopSavedPillLabel = (): string => gated().stopSavedPillLabel();

/**
 * Sign-in and sign-out wording that touches what is kept on the phone.
 *
 * Added after `claimsCopy` rather than inside it so the existing table is
 * untouched, but built the same way: one function of the gate, called with
 * OFFLINE_DURABILITY_VERIFIED by the exports below and with both values by the
 * tests. Gate false, nothing here says work is kept or sent later: it says it is
 * recorded on this phone and must be sent.
 */
export function signInClaimsCopy(verified: boolean) {
  const plural = (count: number, one: string, many: string) =>
    count === 1 ? `1 ${one}` : `${count} ${many}`;

  return {
    /** The line under the sign-in headline (R-01). */
    signInSubcopy(): string {
      return verified
        ? "See your route and record every delivery, even through a signal gap."
        : "See your route and record every delivery.";
    },

    /** The note at the foot of the sign-in sheet (R-01, bulb icon). */
    signInNote(): string {
      return verified
        ? "Lamp Mode saves your work if the signal drops."
        : "If the signal drops, your work is recorded on this phone. Send it before you close the app.";
    },

    /** Shown on the sign-in screen after the session ended. */
    sessionEndedNotice(): string {
      return verified
        ? "Your session ended. Sign in again — anything you recorded is still on this phone."
        : "Your session ended. Sign in again — what you recorded is on this phone, and still needs sending.";
    },

    /** On the Vehicle screen, under "Release vehicle". */
    releaseVehicleNote(vehicleId: string): string {
      return verified
        ? `Releasing ${vehicleId} hands it back to the depot. Anything you have recorded stays on this phone.`
        : `Releasing ${vehicleId} hands it back to the depot. Records made on this phone are not sent by releasing it.`;
    },

    /** The heading over the records waiting on the Unsent records screen. */
    outboxHeldHeading(): string {
      return verified ? "Held on this phone" : "Recorded on this phone, not sent";
    },

    /** On the Connection screen, above Sign out, while records are waiting. */
    signOutKeepsRecordsNote(count: number): string {
      const subject = plural(count, "record", "records");
      return verified
        ? `${subject} still to send. Signing out keeps them on this phone. Sign in again to send them.`
        : `${subject} still to send. Signing out keeps them recorded on this phone, not sent. Sign in again to send them.`;
    },
  };
}

const gatedSignIn = () => signInClaimsCopy(OFFLINE_DURABILITY_VERIFIED);

export const signInSubcopy = (): string => gatedSignIn().signInSubcopy();

export const signInNote = (): string => gatedSignIn().signInNote();

export const sessionEndedNotice = (): string => gatedSignIn().sessionEndedNotice();

export const signOutKeepsRecordsNote = (count: number): string =>
  gatedSignIn().signOutKeepsRecordsNote(count);

/**
 * How a failed-delivery or skipped-stop record travels, for the "What happens
 * next" box (R-11). Same gate as everything above: with the gate off the
 * sentences claim nothing about the phone keeping the record.
 *
 * `connected` is true unless the last verified check said Offline. "Checking" is
 * passed as connected on purpose: the connected sentence is conditional ("if that
 * does not go through ...") and so is true whichever way the check turns out,
 * while the offline sentence would say something the phone has not verified.
 */
export function problemClaimsCopy(verified: boolean) {
  return {
    sendNote(connected: boolean): string {
      if (connected) {
        return verified
          ? "It is sent straight away. If that does not go through, it is held on this phone and sent when there is signal, while the app is open."
          : "It is sent straight away. If that does not go through, it is only recorded on this phone: send it from Unsent records before you close the app.";
      }
      return verified
        ? "You are offline. It is held on this phone and sent when there is signal, while the app is open."
        : "You are offline. It is recorded on this phone, not sent: send it from Unsent records before you close the app.";
    },
  };
}

/** The last line of "What happens next" on the failed-delivery and skip screens. */
export const problemSendNote = (connected: boolean): string =>
  problemClaimsCopy(OFFLINE_DURABILITY_VERIFIED).sendNote(connected);

export const outboxHeldHeading = (): string => gatedSignIn().outboxHeldHeading();

export const releaseVehicleNote = (vehicleId: string): string =>
  gatedSignIn().releaseVehicleNote(vehicleId);

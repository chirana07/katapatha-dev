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
 * TRUE, earned by src/outbox/drain.acceptance.test.ts (6 passing cases): three
 * events queued while the transport was failing drain as accepted=3,
 * duplicates=0, and the identical batch replayed reports duplicates=3 and
 * changes nothing.
 *
 * What that test does and does not establish, stated plainly because the claim
 * rests on it:
 *
 *   IT DOES prove the device side -- the only thing the copy below claims. Events
 *   survive in SQLite across a failed send, the drain settles them, a replay is
 *   harmless, and a double-tap is a no-op. It runs against real SQLite and the
 *   real SQL, with a fake applier that behaves exactly as the contract specifies.
 *
 *   IT DOES NOT prove the server. apps/api/src/services/delivery.ts currently
 *   mints its OWN ULID server-side and guards on stop status instead of keying on
 *   the client's id, and routes/sync.ts is still a 501 stub. So server-side
 *   idempotency -- the thing that makes a replay safe rather than a double-write
 *   -- is unimplemented. BE3 owns it. Re-run these assertions by hand against the
 *   real endpoint the day it lands.
 *
 * The copy is written to stay true under that gap: it promises that a record is
 * kept on the phone and sent when there is signal, which is verified. It does not
 * promise the server will deduplicate.
 */
export const OFFLINE_DURABILITY_VERIFIED = true;

/** How the app describes an event that is recorded here but not yet sent. */
export function unsentCopy(count: number): string {
  const subject = count === 1 ? "1 record" : `${count} records`;
  return OFFLINE_DURABILITY_VERIFIED
    ? `${subject} held on this phone. Sent when there is signal.`
    : `${subject} recorded on this phone. Not sent yet — tap Send when you have signal.`;
}

/** The one-line explanation on the outbox screen. */
export function outboxExplainer(): string {
  return OFFLINE_DURABILITY_VERIFIED
    ? "Records are kept on this phone and sent while the app is open."
    : "Records are kept on this phone for now. Send them before you close the app.";
}

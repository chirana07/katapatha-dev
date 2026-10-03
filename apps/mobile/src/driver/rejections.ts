/**
 * What a driver reads when the server REFUSED one of their records.
 *
 * The sync endpoint judges each event on its own and lists the ones it refused
 * in `rejected: [{ id, code, message }]` (contract: EventRejection). A rejection
 * is a KNOWN outcome -- the server read the event and did not apply it -- so none
 * of this wording says "failed" or "could not send", which would imply the
 * outcome is unknown. Each sentence says what the server did not do, and where
 * the driver can act on it, what to do.
 *
 * The server's own `message` carries ids and developer wording ("Stop clx0...
 * is not on this driver's run"), so it is never shown for a code we know.
 * Unknown codes are terminal too (the contract says so) and get the generic
 * sentence, with the server's message appended when it is short enough to read.
 */

const ASK = "Tell dispatch.";

const WORDING: Record<string, string> = {
  STOP_NOT_ON_RUN:
    "This stop is not on your run, so the server did not take this record. It may have been moved to another vehicle. " +
    ASK,
  MISSING_TRIP_STOP_ID:
    "This record reached the server without its stop, so it was not accepted. " + ASK,
  ID_REUSED:
    "This record clashed with one the server already holds for a different stop, so it was not accepted. " +
    ASK,
  ID_COLLISION:
    "This record clashed with a different one the server already holds, so it was not accepted. " +
    ASK,
  DELIVERED_INCOMPLETE:
    "A delivery line arrived without its order or quantity, so it was not accepted. " + ASK,
  ORDER_NOT_ON_STOP:
    "This order is not on this stop any more, so its delivery was not accepted. " + ASK,
  RECIPIENT_REQUIRED:
    "The server needs the name of the person who received the goods, and this record had none, so the delivery was not accepted. " +
    ASK,
  POD_WITHOUT_DELIVERY:
    "The proof of delivery arrived without any delivered lines, so it was not accepted. " + ASK,
  POD_REJECTED:
    "The proof of delivery for this delivery was refused, so the delivery was not accepted. " + ASK,
  POD_ALREADY_IN_REQUEST:
    "A second proof of delivery for the same stop was not accepted. The first one was the one that counts.",
  STOP_ALREADY_CLOSED:
    "This stop was already closed on the server, so this record was not applied. " + ASK,
  STATE_MISMATCH:
    "The stop was not in the right step for this record (for example it had already moved on), so it was not applied. " +
    ASK,
  PAGES_ON_NON_POD:
    "Photos came attached to a step that cannot carry them, so this record was not accepted. " +
    ASK,
  TOO_MANY_PAGES:
    "This delivery had more receipt pages than the server accepts, so it was not accepted. " + ASK,
  DUPLICATE_PAGE_ID:
    "The same receipt page was attached twice, so this delivery was not accepted. " + ASK,
  PAGE_DATA_INVALID:
    "A receipt page was not an image the server could read, so this delivery was not accepted. " +
    ASK,
  PAGE_TOO_LARGE:
    "A receipt page was too large for the server, so this delivery was not accepted. " + ASK,
  INVALID_OCCURRED_AT:
    "The time recorded on this phone for this step was not valid, so it was not accepted. " + ASK,
};

/** Every code the contract's EventRejection lists. */
export const KNOWN_REJECTION_CODES: readonly string[] = Object.keys(WORDING);

const GENERIC =
  "The server did not accept this record, so it was not applied. " + ASK;

/** Longest server message worth showing next to the generic sentence. */
const MAX_SERVER_MESSAGE = 140;

/** The driver-readable sentence for one rejected event. Pure. */
export function describeRejection(rejection: {
  code?: string | null;
  message?: string | null;
}): string {
  const known = rejection.code ? WORDING[rejection.code] : undefined;
  if (known) return known;

  const message = rejection.message?.trim();
  if (message && message.length <= MAX_SERVER_MESSAGE) {
    return `${GENERIC} The server said: ${message}`;
  }
  return GENERIC;
}

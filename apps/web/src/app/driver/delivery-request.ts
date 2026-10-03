import { API_PAGE_LIMIT_CHARS, MAX_POD_PAGES } from "./image-fit";
import type { DeliveryLine, PodPage } from "./delivery-events";

/**
 * The JSON the delivery form posts to `/driver/stops/[stopId]/delivery`, and the
 * checks it must pass before anything is sent on to the API.
 *
 * Why a route and not a server action: pages travel as data URLs and a full set
 * is several megabytes, well over a server action's default 1 MB body. The API
 * is the authority on every rule below; repeating the cheap ones here means the
 * driver gets a plain-language answer instead of an opaque 422.
 */
export interface DeliveryRequest {
  deviceId: string;
  occurredAt: string;
  recipientName: string;
  lines: DeliveryLine[];
  podEventId: string;
  pages: PodPage[];
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KINDS = new Set(["RECEIPT", "SIGNATURE", "PHOTO"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function parseDeliveryRequest(input: unknown): { ok: true; value: DeliveryRequest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isObject(input)) return fail("This delivery is no longer valid. Reload the stop and try again.");

  const recipientName = typeof input.recipientName === "string" ? input.recipientName.trim() : "";
  if (recipientName.length < 2) {
    return fail("Type the recipient's name before saving. Every delivery is signed off to a real person at the outlet.");
  }
  if (!isIso(input.occurredAt)) return fail("This delivery is no longer valid. Reload the stop and try again.");
  if (typeof input.podEventId !== "string" || !ULID.test(input.podEventId)) {
    return fail("The proof-of-delivery record is no longer valid. Reload the stop and try again.");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return fail("This stop has no order lines to deliver. Reload the run and try again.");
  }
  const lines: DeliveryLine[] = [];
  for (const raw of input.lines) {
    if (!isObject(raw) || typeof raw.orderId !== "string" || raw.orderId === "") {
      return fail("This delivery is missing order details. Reload the stop and try again.");
    }
    if (typeof raw.eventId !== "string" || !ULID.test(raw.eventId)) {
      return fail("This delivery is missing order details. Reload the stop and try again.");
    }
    const { deliveredUnits, expectedUnits } = raw;
    if (!Number.isSafeInteger(deliveredUnits) || !Number.isSafeInteger(expectedUnits) || (deliveredUnits as number) < 0 || (expectedUnits as number) < 0) {
      return fail("Delivered units must be whole numbers, zero or more.");
    }
    if ((deliveredUnits as number) > (expectedUnits as number)) {
      return fail(`${deliveredUnits} is more than the ${expectedUnits} units on this order. Check the figure before saving.`);
    }
    lines.push({
      orderId: raw.orderId,
      eventId: raw.eventId,
      deliveredUnits: deliveredUnits as number,
      expectedUnits: expectedUnits as number,
    });
  }

  const rawPages = input.pages ?? [];
  if (!Array.isArray(rawPages)) return fail("The receipt pages could not be read. Add them again.");
  if (rawPages.length > MAX_POD_PAGES) return fail(`A delivery can carry at most ${MAX_POD_PAGES} pages.`);
  const pages: PodPage[] = [];
  const seen = new Set<string>();
  for (const raw of rawPages) {
    if (!isObject(raw) || typeof raw.id !== "string" || !ULID.test(raw.id) || seen.has(raw.id)) {
      return fail("The receipt pages could not be read. Add them again.");
    }
    seen.add(raw.id);
    if (typeof raw.kind !== "string" || !KINDS.has(raw.kind) || !isIso(raw.capturedAt)) {
      return fail("The receipt pages could not be read. Add them again.");
    }
    if (typeof raw.data !== "string" || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(raw.data)) {
      return fail("A receipt page is not a picture Katapatha can store. Remove it and add it again.");
    }
    if (raw.data.length > API_PAGE_LIMIT_CHARS) {
      return fail("A receipt page is too large to send. Remove it and add it again.");
    }
    pages.push({ id: raw.id, kind: raw.kind as PodPage["kind"], data: raw.data, capturedAt: raw.capturedAt });
  }

  const deviceId = typeof input.deviceId === "string" && input.deviceId.trim() !== "" ? input.deviceId.trim() : "device-unknown";
  return { ok: true, value: { deviceId, occurredAt: input.occurredAt, recipientName, lines, podEventId: input.podEventId, pages } };
}

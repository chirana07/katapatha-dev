import { newPageId, type PodPageInput } from "./intents";

/**
 * Pages for tests. Not shipped: nothing in the app imports this.
 * Each call mints fresh page ids, as the capture screen does.
 */
export const JPEG = "data:image/jpeg;base64,/9j/4AAQ";
export const SVG = "data:image/svg+xml;base64,PHN2Zz4=";

export function receiptPage(over: Partial<PodPageInput> = {}): PodPageInput {
  return {
    id: newPageId(),
    kind: "RECEIPT",
    data: JPEG,
    qualityFlags: [],
    capturedAt: "2026-10-01T04:09:00.000Z",
    ...over,
  };
}

export function signaturePage(over: Partial<PodPageInput> = {}): PodPageInput {
  return {
    id: newPageId(),
    kind: "SIGNATURE",
    data: SVG,
    qualityFlags: [],
    capturedAt: "2026-10-01T04:09:30.000Z",
    ...over,
  };
}

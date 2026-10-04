import {
  CORNERS_NOT_CONFIRMED,
  MAX_POD_PAGES,
  SIGNATURE_NOT_CONFIRMED,
  TEXT_NOT_CONFIRMED,
  type PodPageInput,
} from "../../outbox/intents";

/**
 * The receipt pages a driver is building on the Receipt step. Pure: the screen
 * holds one `PageList` in state and every change is a function of it, so the cap,
 * the selection rules and the flags are tested without a phone.
 *
 * Quality ticks are the DRIVER's own confirmation that a capture is usable
 * ("All 4 corners", "Text sharp", "Signature visible"). They start unticked and an
 * unticked one is RECORDED as a *_NOT_CONFIRMED flag; it never blocks completing.
 * Nothing here is, or says, a machine verdict.
 */

export type TickKey = "corners" | "text" | "signature";

export type Ticks = Record<TickKey, boolean>;

export const NO_TICKS: Ticks = { corners: false, text: false, signature: false };

/** What a tick means, in the words on the chip, and the flag it leaves unrecorded when unticked. */
export const TICKS: ReadonlyArray<{ key: TickKey; label: string; flag: string }> = [
  { key: "corners", label: "All 4 corners", flag: CORNERS_NOT_CONFIRMED },
  { key: "text", label: "Text sharp", flag: TEXT_NOT_CONFIRMED },
  { key: "signature", label: "Signature visible", flag: SIGNATURE_NOT_CONFIRMED },
];

export type DraftPage = {
  id: string;
  /** A camera page is a RECEIPT; the on-phone signature is a SIGNATURE. */
  kind: "RECEIPT" | "SIGNATURE";
  /** Base64 data URL, exactly what will be queued. */
  data: string;
  /** Device clock when the page was taken, ISO 8601. */
  capturedAt: string;
  /** Only meaningful for a RECEIPT page. */
  ticks: Ticks;
  /**
   * SIGNATURE only: the SVG source, so the preview can draw it. React Native's
   * <Image> cannot show image/svg+xml, and decoding the base64 back is needless
   * work when the XML was just built.
   */
  previewXml?: string;
};

export type PageList = {
  pages: DraftPage[];
  selectedId: string | null;
};

export const EMPTY_PAGES: PageList = { pages: [], selectedId: null };

export function canAddPage(list: PageList): boolean {
  return list.pages.length < MAX_POD_PAGES;
}

/** Appends and selects the new page. At the cap it returns the list unchanged. */
export function addPage(list: PageList, page: DraftPage): PageList {
  if (!canAddPage(list) || list.pages.some((existing) => existing.id === page.id)) return list;
  return { pages: [...list.pages, page], selectedId: page.id };
}

/**
 * A retake: the same slot gets a new capture. The ticks reset, because they were
 * the driver's confirmation about the PREVIOUS photo, not this one.
 */
export function replacePage(
  list: PageList,
  id: string,
  next: { data: string; capturedAt: string },
): PageList {
  if (!list.pages.some((page) => page.id === id)) return list;
  return {
    pages: list.pages.map((page) =>
      page.id === id
        ? { ...page, data: next.data, capturedAt: next.capturedAt, ticks: { ...NO_TICKS } }
        : page,
    ),
    selectedId: id,
  };
}

/** Removes a page. The page before it (else the new first) becomes selected when it was. */
export function removePage(list: PageList, id: string): PageList {
  const index = list.pages.findIndex((page) => page.id === id);
  if (index === -1) return list;
  const pages = list.pages.filter((page) => page.id !== id);
  const selectedId =
    list.selectedId !== id
      ? list.selectedId
      : (pages[Math.max(0, index - 1)]?.id ?? null);
  return { pages, selectedId };
}

export function selectPage(list: PageList, id: string): PageList {
  if (!list.pages.some((page) => page.id === id)) return list;
  return { ...list, selectedId: id };
}

export function toggleTick(list: PageList, id: string, key: TickKey): PageList {
  return {
    ...list,
    pages: list.pages.map((page) =>
      page.id === id && page.kind === "RECEIPT"
        ? { ...page, ticks: { ...page.ticks, [key]: !page.ticks[key] } }
        : page,
    ),
  };
}

export function selectedPage(list: PageList): DraftPage | null {
  return list.pages.find((page) => page.id === list.selectedId) ?? list.pages[0] ?? null;
}

/** "Page 2 of 3", or null when there is no page. */
export function pageCounter(list: PageList): string | null {
  const page = selectedPage(list);
  if (!page) return null;
  return `Page ${list.pages.indexOf(page) + 1} of ${list.pages.length}`;
}

/**
 * The flags recorded for a page: one per UNTICKED chip on a receipt page.
 * A signature page carries none: the chips describe a photographed receipt.
 */
export function qualityFlagsFor(page: Pick<DraftPage, "kind" | "ticks">): string[] {
  if (page.kind !== "RECEIPT") return [];
  return TICKS.filter((tick) => !page.ticks[tick.key]).map((tick) => tick.flag);
}

/** The pages as the outbox takes them, in the order the driver arranged them. */
export function toPodPages(list: PageList): PodPageInput[] {
  return list.pages.map((page) => ({
    id: page.id,
    kind: page.kind,
    data: page.data,
    qualityFlags: qualityFlagsFor(page),
    capturedAt: page.capturedAt,
  }));
}

/** Total characters (= bytes, base64 is ASCII) across the pages, for the queue headroom check. */
export function pagesBytes(list: PageList): number {
  return list.pages.reduce((sum, page) => sum + page.data.length, 0);
}

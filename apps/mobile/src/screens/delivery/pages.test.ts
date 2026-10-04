import { describe, it, expect } from "vitest";
import { MAX_POD_PAGES } from "../../outbox/intents";
import {
  EMPTY_PAGES,
  NO_TICKS,
  addPage,
  canAddPage,
  pageCounter,
  pagesBytes,
  qualityFlagsFor,
  removePage,
  replacePage,
  selectPage,
  selectedPage,
  toPodPages,
  toggleTick,
  type DraftPage,
} from "./pages";

const JPEG = "data:image/jpeg;base64,/9j/4AAQ";
const SVG = "data:image/svg+xml;base64,PHN2Zz4=";

function page(id: string, over: Partial<DraftPage> = {}): DraftPage {
  return {
    id,
    kind: "RECEIPT",
    data: JPEG,
    capturedAt: "2026-10-01T04:09:00.000Z",
    ticks: { ...NO_TICKS },
    ...over,
  };
}

describe("adding and selecting", () => {
  it("adds a page and selects it", () => {
    const list = addPage(EMPTY_PAGES, page("a"));
    expect(list.pages.map((p) => p.id)).toEqual(["a"]);
    expect(list.selectedId).toBe("a");
    expect(addPage(list, page("b")).selectedId).toBe("b");
  });

  it("refuses a ninth page and an id it already holds", () => {
    let list = EMPTY_PAGES;
    for (let i = 0; i < MAX_POD_PAGES; i += 1) list = addPage(list, page(`p${i}`));
    expect(list.pages).toHaveLength(MAX_POD_PAGES);
    expect(canAddPage(list)).toBe(false);
    expect(addPage(list, page("extra"))).toBe(list);

    const small = addPage(EMPTY_PAGES, page("a"));
    expect(addPage(small, page("a"))).toBe(small);
  });

  it("selects an existing page only", () => {
    const list = addPage(addPage(EMPTY_PAGES, page("a")), page("b"));
    expect(selectPage(list, "a").selectedId).toBe("a");
    expect(selectPage(list, "nope")).toBe(list);
  });

  it("falls back to the first page when nothing is selected", () => {
    expect(selectedPage(EMPTY_PAGES)).toBe(null);
    const list = { pages: [page("a"), page("b")], selectedId: null };
    expect(selectedPage(list)?.id).toBe("a");
  });

  it("counts 'Page i of n' from the selected page", () => {
    expect(pageCounter(EMPTY_PAGES)).toBe(null);
    const list = addPage(addPage(EMPTY_PAGES, page("a")), page("b"));
    expect(pageCounter(list)).toBe("Page 2 of 2");
    expect(pageCounter(selectPage(list, "a"))).toBe("Page 1 of 2");
  });
});

describe("retaking and removing", () => {
  it("a retake swaps the capture in place and clears the ticks (they were about the old photo)", () => {
    let list = addPage(EMPTY_PAGES, page("a"));
    list = toggleTick(list, "a", "corners");
    expect(list.pages[0].ticks.corners).toBe(true);

    const next = replacePage(list, "a", { data: "data:image/jpeg;base64,AAAA", capturedAt: "2026-10-01T04:20:00.000Z" });
    expect(next.pages).toHaveLength(1);
    expect(next.pages[0]).toMatchObject({ id: "a", data: "data:image/jpeg;base64,AAAA", capturedAt: "2026-10-01T04:20:00.000Z" });
    expect(next.pages[0].ticks).toEqual(NO_TICKS);
    expect(replacePage(list, "missing", { data: "x", capturedAt: "y" })).toBe(list);
  });

  it("removing the selected page selects the one before it, else the new first, else none", () => {
    let list = EMPTY_PAGES;
    for (const id of ["a", "b", "c"]) list = addPage(list, page(id));
    list = removePage(list, "c");
    expect(list.selectedId).toBe("b");
    list = removePage(selectPage(list, "a"), "a");
    expect(list.selectedId).toBe("b");
    list = removePage(list, "b");
    expect(list).toEqual({ pages: [], selectedId: null });
  });

  it("removing another page keeps the selection", () => {
    let list = addPage(addPage(EMPTY_PAGES, page("a")), page("b"));
    list = selectPage(list, "a");
    expect(removePage(list, "b").selectedId).toBe("a");
    expect(removePage(list, "nope")).toBe(list);
  });
});

describe("the driver's own confirmation chips", () => {
  it("starts with every chip unticked, so every flag is recorded", () => {
    const list = addPage(EMPTY_PAGES, page("a"));
    expect(qualityFlagsFor(list.pages[0])).toEqual([
      "CORNERS_NOT_CONFIRMED",
      "TEXT_NOT_CONFIRMED",
      "SIGNATURE_NOT_CONFIRMED",
    ]);
  });

  it("each ticked chip removes exactly its own flag, and unticking restores it", () => {
    let list = addPage(EMPTY_PAGES, page("a"));
    list = toggleTick(list, "a", "text");
    expect(qualityFlagsFor(list.pages[0])).toEqual(["CORNERS_NOT_CONFIRMED", "SIGNATURE_NOT_CONFIRMED"]);
    list = toggleTick(toggleTick(list, "a", "corners"), "a", "signature");
    expect(qualityFlagsFor(list.pages[0])).toEqual([]);
    list = toggleTick(list, "a", "text");
    expect(qualityFlagsFor(list.pages[0])).toEqual(["TEXT_NOT_CONFIRMED"]);
  });

  it("ticks belong to one page", () => {
    let list = addPage(addPage(EMPTY_PAGES, page("a")), page("b"));
    list = toggleTick(list, "a", "corners");
    expect(list.pages[0].ticks.corners).toBe(true);
    expect(list.pages[1].ticks.corners).toBe(false);
  });

  it("an on-phone signature page carries no flags and ignores ticks", () => {
    let list = addPage(EMPTY_PAGES, page("s", { kind: "SIGNATURE", data: SVG }));
    list = toggleTick(list, "s", "corners");
    expect(list.pages[0].ticks).toEqual(NO_TICKS);
    expect(qualityFlagsFor(list.pages[0])).toEqual([]);
  });
});

describe("handing the pages to the outbox", () => {
  it("keeps order, ids, kinds, capture times and flags, and leaves the draft-only fields behind", () => {
    let list = addPage(EMPTY_PAGES, page("a", { previewXml: "<svg/>" }));
    list = addPage(list, page("s", { kind: "SIGNATURE", data: SVG, capturedAt: "2026-10-01T04:11:00.000Z" }));
    list = toggleTick(toggleTick(toggleTick(list, "a", "corners"), "a", "text"), "a", "signature");

    expect(toPodPages(list)).toEqual([
      { id: "a", kind: "RECEIPT", data: JPEG, qualityFlags: [], capturedAt: "2026-10-01T04:09:00.000Z" },
      { id: "s", kind: "SIGNATURE", data: SVG, qualityFlags: [], capturedAt: "2026-10-01T04:11:00.000Z" },
    ]);
    expect(pagesBytes(list)).toBe(JPEG.length + SVG.length);
  });
});

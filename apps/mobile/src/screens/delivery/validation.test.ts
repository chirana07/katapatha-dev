import { describe, it, expect } from "vitest";
import { MAX_PHOTO_BYTES, MAX_QUEUED_BLOB_BYTES, MAX_SIGNATURE_BYTES } from "../../pod/size";
import { EMPTY_PAGES, NO_TICKS, addPage, type DraftPage } from "./pages";
import {
  RECIPIENT_PROBLEM,
  countsProblem,
  draftProblem,
  headroomProblem,
  pagesSizeProblem,
  requirementNote,
} from "./validation";

const ORDERS = [
  { orderId: "a", orderRef: "S1-082", expectedUnits: 10 },
  { orderId: "b", orderRef: "S1-083", expectedUnits: 5 },
];
const JPEG = "data:image/jpeg;base64,/9j/4AAQ";

const page = (over: Partial<DraftPage> = {}): DraftPage => ({
  id: "p1",
  kind: "RECEIPT",
  data: JPEG,
  capturedAt: "2026-10-01T04:09:00.000Z",
  ticks: { ...NO_TICKS },
  ...over,
});
const one = addPage(EMPTY_PAGES, page());

describe("countsProblem", () => {
  it("accepts zero up to expected, whole numbers only", () => {
    expect(countsProblem(ORDERS, { a: 10, b: 0 })).toBe(null);
    expect(countsProblem(ORDERS, {})).toBe(null);
  });

  it("refuses fractions, negatives, blanks and non-numbers", () => {
    for (const bad of ["1.5", "-1", "", " ", "abc", 2.5, -3]) {
      expect(countsProblem(ORDERS, { a: bad as string | number })).toBe(
        "Delivered units must be whole numbers, zero or more.",
      );
    }
  });

  it("refuses more than expected, naming the order", () => {
    expect(countsProblem(ORDERS, { a: 11 })).toBe(
      "11 is more than the 10 units on S1-082. Check the figure before saving.",
    );
  });

  it("refuses a number JavaScript cannot hold exactly", () => {
    expect(countsProblem(ORDERS, { a: "9007199254740993" })).toBe(
      "Delivered quantities are too large to save safely. Check the figures.",
    );
  });
});

describe("page size and queue headroom", () => {
  it("holds a receipt photo to 400 KB and a signature to 64 KB", () => {
    const pad = (n: number) => "data:image/jpeg;base64," + "A".repeat(n);
    const big = addPage(EMPTY_PAGES, page({ data: pad(MAX_PHOTO_BYTES) }));
    expect(pagesSizeProblem(big)).toMatch(/photo is too large/);
    const sig = addPage(EMPTY_PAGES, page({ kind: "SIGNATURE", data: pad(MAX_SIGNATURE_BYTES) }));
    expect(pagesSizeProblem(sig)).toMatch(/signature is too large/);
    expect(pagesSizeProblem(one)).toBe(null);
  });

  it("refuses when the phone already holds too much, with the existing wording", () => {
    expect(headroomProblem(0, one)).toBe(null);
    expect(headroomProblem(MAX_QUEUED_BLOB_BYTES, one)).toMatch(/holding as much unsent photo evidence as it can/);
  });
});

describe("draftProblem: the order the driver fixes things in", () => {
  const good = { recipient: "Nimali", orders: ORDERS, counts: { a: 10, b: 5 }, pages: one };

  it("is null for a complete draft", () => {
    expect(draftProblem(good)).toBe(null);
  });

  it("asks for the name first, then the counts, then a page", () => {
    expect(draftProblem({ ...good, recipient: "N", counts: { a: 99 }, pages: EMPTY_PAGES })).toBe(RECIPIENT_PROBLEM);
    expect(draftProblem({ ...good, recipient: " N ", pages: one })).toBe(RECIPIENT_PROBLEM);
    expect(draftProblem({ ...good, counts: { a: 99 }, pages: EMPTY_PAGES })).toMatch(/more than the 10 units/);
    expect(draftProblem({ ...good, pages: EMPTY_PAGES })).toBe(
      "Add a photo of the receipt, or sign on the phone, before completing.",
    );
  });
});

describe("requirementNote", () => {
  it("says what is missing, in words", () => {
    expect(requirementNote({ recipient: "Nimali", pages: one })).toBe(null);
    expect(requirementNote({ recipient: "Nimali", pages: EMPTY_PAGES })).toBe(
      "To complete: add a receipt photo, or sign on the phone.",
    );
    expect(requirementNote({ recipient: "", pages: one })).toBe("To complete: type who received the goods.");
    expect(requirementNote({ recipient: "x", pages: EMPTY_PAGES })).toMatch(/receipt photo.*who received/);
  });
});

import { describe, expect, it } from "vitest";
import { historyOutcome, matchesResult, parseRange, rangeStart, recordedAgainstOrdered } from "./history-view";
import { describeIssue, issueChoices, issueStatusLabel, reportableOrders } from "./issue-view";
import { matchesQuery, matchesTab, paginate, parseTab, tabCounts } from "./order-list";
import { progressSteps, storeStateTone } from "./order-state";
import { arrivalView, awaitingReceipt, isLamp, lastReportedLine, stopsAndCountdown, todayCards, weatherCaption } from "./today-view";
import { safeStorePath, validateIssue } from "./validation";

const order = (over: object) =>
  ({ id: "o", ref: "R", brand: "Fresh", tempRequirement: "ambient", units: 10, requestedDate: "2026-04-09", state: "delivered", receiptConfirmed: false, ...over }) as never;

describe("Today", () => {
  it("only asks for a receipt on delivered orders that have none", () => {
    const orders = [order({ id: "a" }), order({ id: "b", receiptConfirmed: true }), order({ id: "c", state: "planned" })];
    expect(awaitingReceipt(orders).map((o) => o.id)).toEqual(["a"]);
  });

  it("says what each count asks of the manager", () => {
    const cards = todayCards({
      counts: { expected: 2, confirmed: 0, pending: 1, issues: 0 },
      incoming: null,
      orders: [order({ ref: "S1-082" })],
    });
    expect(cards.pending.foot).toBe("Confirm receipt of S1-082");
    expect(cards.confirmed.foot).toBe("Waiting for you");
    expect(cards.issues.foot).toBe("No issues");
    expect(cards.expected.foot).toBe("Not yet planned");
  });

  it("words the arrival to match its basis, and an estimate is always a range", () => {
    expect(arrivalView({ arrival: { basis: "plan", at: "10:00", from: null, to: null } })).toMatchObject({
      label: "Planned arrival",
      headline: "10:00",
      foot: "Planned arrival 10:00",
    });
    expect(arrivalView({ arrival: { basis: "report", at: "07:33", from: null, to: null } })).toMatchObject({
      label: "Expected arrival",
      headline: "07:33",
      foot: "Expected about 07:33",
    });
    const estimate = arrivalView({ arrival: { basis: "estimate", at: null, from: "07:28", to: "07:55" } });
    expect(estimate).toMatchObject({ label: "Estimated arrival", headline: "07:28–07:55", foot: "Estimated 07:28–07:55" });
    expect(estimate.source).toMatch(/range/);
    expect(estimate.source).not.toMatch(/live|tracking/i);
  });

  it("does not invent a time when an estimate has no range", () => {
    expect(arrivalView({ arrival: { basis: "estimate", at: null, from: null, to: null } }).headline).toBe("Not available");
  });

  it("detects Lamp Mode from either signal", () => {
    const plan = { arrival: { basis: "plan", at: "10:00", from: null, to: null } } as const;
    expect(isLamp(plan)).toBe(false);
    expect(isLamp({ ...plan, report: { reportedAt: "2026-04-09T01:00:00Z", ageSeconds: 60, lamp: false } })).toBe(false);
    expect(isLamp({ ...plan, report: { reportedAt: "2026-04-09T01:00:00Z", ageSeconds: 1320, lamp: true } })).toBe(true);
    expect(isLamp({ arrival: { basis: "estimate", at: null, from: "07:28", to: "07:55" } })).toBe(true);
  });

  it("states the last report with its age, from when the fix was taken", () => {
    expect(lastReportedLine(null)).toBeNull();
    // 06:28 Colombo is 00:58 UTC.
    expect(lastReportedLine({ reportedAt: "2026-09-29T00:58:00Z", ageSeconds: 1320, lamp: true })).toBe("Last reported 06:28 · 22 min ago");
    expect(lastReportedLine({ reportedAt: "2026-09-29T00:58:00Z", ageSeconds: 20, lamp: false })).toBe("Last reported 06:28 · just now");
  });

  it("shows a countdown only when it is honest", () => {
    const base = { stopsBefore: 1, departed: true, minutesAway: 39, arrival: { basis: "plan", at: "07:21", from: null, to: null } } as const;
    expect(stopsAndCountdown(base)).toBe("1 stop before yours · about 39 min by the plan");
    expect(stopsAndCountdown({ ...base, stopsBefore: 0 })).toBe("Yours is the next stop · about 39 min by the plan");
    // Not departed: a countdown to a plan nobody has started would mislead.
    expect(stopsAndCountdown({ ...base, departed: false })).toBe("1 stop before yours");
    expect(stopsAndCountdown({ ...base, minutesAway: null })).toBe("1 stop before yours");
    // Lamp Mode never shows one, whichever signal says so.
    expect(stopsAndCountdown({ ...base, arrival: { basis: "estimate", at: null, from: "07:28", to: "07:55" } })).toBe("1 stop before yours");
    expect(stopsAndCountdown({ ...base, report: { reportedAt: "2026-09-29T00:58:00Z", ageSeconds: 1320, lamp: true } })).toBe("1 stop before yours");
  });

  it("never lets a calendar fallback wear a temperature", () => {
    expect(weatherCaption({ place: "P", label: "Overcast", kind: "cloudy", live: true, temperatureC: 27, observedAt: "22:15" })).toEqual({
      headline: "27°C · Overcast",
      note: "Now, as of 22:15",
    });
    const fallback = weatherCaption({ place: "P", label: "Monsoon season", kind: "rain", live: false, temperatureC: 31, observedAt: null });
    expect(fallback.headline).toBe("Monsoon season");
    expect(fallback.note).toMatch(/not an observation/);
  });
});

describe("order list", () => {
  it("groups states into the tabs", () => {
    expect(matchesTab("on_the_way", "open")).toBe(true);
    expect(matchesTab("delivered", "open")).toBe(false);
    expect(matchesTab("deferred", "deferred")).toBe(true);
    expect(matchesTab("anything", "all")).toBe(true);
    expect(parseTab("nonsense")).toBe("all");
  });

  it("counts every tab", () => {
    const counts = tabCounts([{ status: "QUEUED" }, { status: "DELIVERED" }, { status: "DEFERRED" }, { status: "PLANNED" }]);
    expect(counts).toEqual({ all: 4, open: 2, delivered: 1, deferred: 1, cancelled: 0 });
  });

  it("searches by reference without caring about case", () => {
    expect(matchesQuery("DEMO-006", "demo-0")).toBe(true);
    expect(matchesQuery("DEMO-006", "  ")).toBe(true);
    expect(matchesQuery("DEMO-006", "xyz")).toBe(false);
  });

  it("clamps the page into range", () => {
    const items = Array.from({ length: 14 }, (_, i) => i);
    expect(paginate(items, "2", 10)).toMatchObject({ page: 2, from: 11, to: 14, pages: 2, total: 14 });
    expect(paginate(items, "99", 10).page).toBe(2);
    expect(paginate(items, "-3", 10).page).toBe(1);
    expect(paginate(items, "abc", 10).page).toBe(1);
    expect(paginate([], undefined, 10)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
});

describe("order state", () => {
  it("colours deferral as a warning, not an error", () => {
    expect(storeStateTone("deferred")).toBe("warn");
    expect(storeStateTone("failed")).toBe("bad");
    expect(storeStateTone("delivered")).toBe("good");
  });

  it("draws the tracker only for orders still on the path", () => {
    expect(progressSteps("planned")?.map((s) => s.state)).toEqual(["done", "current", "todo", "todo"]);
    expect(progressSteps("deferred")).toBeNull();
    expect(progressSteps("cancelled")).toBeNull();
  });
});

describe("history outcome", () => {
  it("puts a shortfall first and carries the rest as notes", () => {
    const outcome = historyOutcome({ state: "delivered", units: 64, deliveredUnits: 60, receiptConfirmed: false, issues: [{ status: "NEW" }] });
    expect(outcome).toMatchObject({ label: "Short 4", tone: "bad" });
    expect(outcome.notes).toEqual(["Issue open", "Receipt not confirmed"]);
  });

  it("asks for the receipt before calling a delivery received", () => {
    expect(historyOutcome({ state: "delivered", units: 5, deliveredUnits: 5, receiptConfirmed: false }).label).toBe("Confirm receipt");
    expect(historyOutcome({ state: "delivered", units: 5, deliveredUnits: 5, receiptConfirmed: true })).toMatchObject({ label: "Received", tone: "good" });
  });

  it("does not claim a receipt it never looked up", () => {
    expect(historyOutcome({ state: "delivered", units: 5 }).label).toBe("Delivered");
  });

  it("says where a deferred order went", () => {
    expect(historyOutcome({ state: "deferred", units: 5, deferral: { rolledToDate: "2026-09-30" } }).notes).toEqual(["Moved to Wed 30 Sep"]);
    expect(historyOutcome({ state: "deferred", units: 5, deferral: { rolledToDate: null } }).notes).toEqual(["No new date yet"]);
  });

  it("filters by result and range", () => {
    expect(matchesResult({ tone: "good" }, "received")).toBe(true);
    expect(matchesResult({ tone: "warn" }, "attention")).toBe(true);
    expect(matchesResult({ tone: "good" }, "attention")).toBe(false);
    expect(parseRange(undefined)).toBe("all");
    expect(rangeStart("30", "2026-10-03")).toBe("2026-09-03");
    expect(rangeStart("all", "2026-10-03")).toBeNull();
    expect(recordedAgainstOrdered(null, 12)).toBe("— / 12");
    expect(recordedAgainstOrdered(10, 12)).toBe("10 / 12");
  });
});

describe("issues", () => {
  it("expands the goods kind into one tile per reason and keeps the other kinds whole", () => {
    const choices = issueChoices(["GOODS_DAMAGED", "OTHER"], ["ITEMS_MISSING", "WRONG_ITEMS"]);
    expect(choices.map((c) => c.key)).toEqual(["GOODS_DAMAGED:ITEMS_MISSING", "GOODS_DAMAGED:WRONG_ITEMS", "OTHER"]);
    expect(choices[0]).toMatchObject({ kind: "GOODS_DAMAGED", reasonCode: "ITEMS_MISSING", label: "Items missing" });
    expect(choices[2]!.reasonCode).toBeUndefined();
  });

  it("reads a code it has no label for", () => {
    expect(issueChoices(["BRAND_NEW_KIND"], [])[0]!.label).toBe("Brand new kind");
    expect(describeIssue({ kind: "OTHER", reasonCode: null })).toBe("Something else");
    expect(issueStatusLabel("ACKNOWLEDGED")).toBe("Dispatch has it");
  });

  it("offers only deliveries that can have a problem", () => {
    const orders = [
      { status: "QUEUED", storeState: "queued" },
      { status: "PLANNED", storeState: "planned" },
      { status: "IN_TRANSIT", storeState: "on_the_way" },
      { status: "DELIVERED", storeState: "delivered" },
      { status: "DEFERRED", storeState: "deferred" },
    ] as const;
    expect(reportableOrders(orders).map((o) => o.status)).toEqual(["IN_TRANSIT", "DELIVERED"]);
  });
});

describe("validateIssue", () => {
  const base = { orderId: "o1", choice: "GOODS_DAMAGED:ITEMS_MISSING", units: "4", note: "  short  ", clientRequestId: "3f2b8e9a-7c41-4d0e-9a52-6b1f0c8d2e11" };

  it("builds the API request from the tile", () => {
    expect(validateIssue(base)).toEqual({
      ok: true,
      data: { orderId: "o1", kind: "GOODS_DAMAGED", reasonCode: "ITEMS_MISSING", units: 4, note: "short", clientRequestId: base.clientRequestId },
    });
    const bare = validateIssue({ ...base, choice: "OTHER", units: "", note: "" });
    expect(bare).toEqual({ ok: true, data: { orderId: "o1", kind: "OTHER", clientRequestId: base.clientRequestId } });
  });

  it("refuses what the API would refuse, in words", () => {
    expect(validateIssue({ ...base, orderId: "" }).ok).toBe(false);
    expect(validateIssue({ ...base, choice: "NOPE" }).ok).toBe(false);
    expect(validateIssue({ ...base, choice: "OTHER:MADE_UP" }).ok).toBe(false);
    expect(validateIssue({ ...base, units: "0" }).ok).toBe(false);
    expect(validateIssue({ ...base, units: "1.5" }).ok).toBe(false);
    expect(validateIssue({ ...base, note: "x".repeat(501) }).ok).toBe(false);
    expect(validateIssue({ ...base, clientRequestId: "not-a-uuid" }).ok).toBe(false);
  });
});

describe("safeStorePath", () => {
  it("only follows paths inside the store workspace", () => {
    expect(safeStorePath("/store?date=2026-04-09")).toBe("/store?date=2026-04-09");
    expect(safeStorePath("/store/orders/abc")).toBe("/store/orders/abc");
    expect(safeStorePath("//evil.example")).toBe("/store");
    expect(safeStorePath("/storefront")).toBe("/store");
    expect(safeStorePath("https://evil.example/store")).toBe("/store");
    expect(safeStorePath(null)).toBe("/store");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  calendarDay: { findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock("../lib/db", () => ({ prisma: prismaMock }));

const { nextOperatingDate } = await import("../services/store.js");

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("nextOperatingDate", () => {
  beforeEach(() => {
    prismaMock.calendarDay.findFirst.mockReset();
    prismaMock.calendarDay.findMany.mockReset();
  });

  it("uses the reference calendar while it has a future operating day", async () => {
    prismaMock.calendarDay.findFirst.mockResolvedValue({ date: new Date("2026-04-13T00:00:00.000Z") });
    expect(iso(await nextOperatingDate(new Date("2026-04-11T00:00:00.000Z")))).toBe("2026-04-13");
    expect(prismaMock.calendarDay.findMany).not.toHaveBeenCalled();
  });

  it("falls back to Monday–Saturday past the end of the calendar instead of null", async () => {
    prismaMock.calendarDay.findFirst.mockResolvedValue(null);
    prismaMock.calendarDay.findMany.mockResolvedValue([]);
    // 2026-10-03 is a Saturday: the next operating day is Monday 5 Oct.
    expect(iso(await nextOperatingDate(new Date("2026-10-03T00:00:00.000Z")))).toBe("2026-10-05");
    expect(iso(await nextOperatingDate(new Date("2026-10-05T00:00:00.000Z")))).toBe("2026-10-06");
  });

  it("still honours known closed days at the edge of the calendar", async () => {
    prismaMock.calendarDay.findFirst.mockResolvedValue(null);
    // The calendar knows the 18th is its last row and closed; the 19th is a Sunday.
    prismaMock.calendarDay.findMany.mockResolvedValue([
      { date: new Date("2026-04-18T00:00:00.000Z"), isOperating: false },
    ]);
    expect(iso(await nextOperatingDate(new Date("2026-04-17T00:00:00.000Z")))).toBe("2026-04-20");
  });
});

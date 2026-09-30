import { describe, expect, it } from "vitest";
import {
  addMin,
  countdown,
  diffMin,
  forwardMin,
  fromMin,
  hoursMinutes,
  laterOf,
  toMin,
  withinWindow,
} from "./time";

describe("toMin and fromMin", () => {
  it("round-trips a clock time", () => {
    expect(toMin("07:04")).toBe(424);
    expect(fromMin(424)).toBe("07:04");
  });

  it("handles the ends of the day", () => {
    expect(toMin("00:00")).toBe(0);
    expect(toMin("23:59")).toBe(1439);
    expect(fromMin(0)).toBe("00:00");
    expect(fromMin(1439)).toBe("23:59");
  });

  it("rejects malformed input instead of returning NaN", () => {
    // The old prototype's version returned NaN here and the bad value then
    // flowed into arithmetic, surfacing much later as a blank cell on screen.
    expect(() => toMin("7:04")).toThrow();
    expect(() => toMin("25:00")).toThrow();
    expect(() => toMin("07:60")).toThrow();
    expect(() => toMin("")).toThrow();
  });

  it("wraps rather than producing an impossible clock time", () => {
    expect(fromMin(1440)).toBe("00:00");
    expect(fromMin(1500)).toBe("01:00");
    expect(fromMin(-30)).toBe("23:30");
  });
});

describe("diffMin and forwardMin", () => {
  it("measures a span within one day", () => {
    expect(diffMin("04:07", "05:07")).toBe(60);
    expect(diffMin("06:04", "07:17")).toBe(73);
  });

  it("goes negative when b precedes a", () => {
    expect(diffMin("05:00", "04:00")).toBe(-60);
  });

  it("treats a backwards span as crossing midnight when asked", () => {
    // The loader starts at 01:30 and Fresh windows open at 03:00, so spans
    // that cross midnight are plausible enough to handle rather than hope.
    expect(forwardMin("23:30", "01:30")).toBe(120);
    expect(forwardMin("04:00", "05:00")).toBe(60);
  });
});

describe("addMin", () => {
  it("advances a clock time", () => {
    expect(addMin("05:30", 45)).toBe("06:15");
    expect(addMin("03:30", 24)).toBe("03:54");
  });

  it("wraps past midnight", () => {
    expect(addMin("23:45", 30)).toBe("00:15");
  });
});

describe("withinWindow", () => {
  it("is inclusive at both ends", () => {
    expect(withinWindow("05:00", "05:00", "07:30")).toBe(true);
    expect(withinWindow("07:30", "05:00", "07:30")).toBe(true);
  });

  it("excludes times outside", () => {
    expect(withinWindow("04:59", "05:00", "07:30")).toBe(false);
    expect(withinWindow("07:31", "05:00", "07:30")).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    expect(withinWindow("23:30", "22:00", "02:00")).toBe(true);
    expect(withinWindow("01:00", "22:00", "02:00")).toBe(true);
    expect(withinWindow("12:00", "22:00", "02:00")).toBe(false);
  });
});

describe("formatting", () => {
  it("renders a countdown as minutes and seconds", () => {
    expect(countdown(diffMin("04:42", "05:30"))).toBe("48:00");
    expect(countdown(0)).toBe("00:00");
    expect(countdown(-5)).toBe("00:00");
  });

  it("renders a duration in hours and minutes", () => {
    expect(hoursMinutes(diffMin("05:30", "16:00"))).toBe("10 h 30 m");
    expect(hoursMinutes(45)).toBe("45 m");
    expect(hoursMinutes(120)).toBe("2 h");
  });
});

describe("laterOf", () => {
  it("picks the later time, which is how service start is defined", () => {
    // A vehicle arriving before the window opens waits, and that wait is not
    // handling time. This is the rule the Datathon's label construction uses.
    expect(laterOf("03:54", "05:00")).toBe("05:00");
    expect(laterOf("06:10", "05:00")).toBe("06:10");
  });
});

import { describe, expect, it } from "vitest";
import { nightColor, color, type Scheme } from "@katapatha/tokens/tokens";
import { contrastRatio, compositeOver } from "./contrast";
import { ICON_NAMES, ICON_PATHS } from "./iconPaths";
import {
  computeInsets,
  nudgeCount,
  parseCount,
  progressLabel,
  progressPercent,
  stepBadgeLabel,
  stepTrackerState,
  STOP_BADGE_SPEC,
} from "./logic";
import {
  CHIP_ON_NAVY,
  DANGER,
  HEADER,
  TONES,
  schemeFromSystem,
  themeFor,
  toneForStatus,
  toneStyles,
  toneTable,
} from "./tokens";

const SCHEMES: Scheme[] = ["light", "dark"];
const AA = 4.5;

describe("themeFor / schemeFromSystem", () => {
  it("maps the system setting, null and unknown included, to light", () => {
    expect(schemeFromSystem("dark")).toBe("dark");
    expect(schemeFromSystem("light")).toBe("light");
    expect(schemeFromSystem(null)).toBe("light");
    expect(schemeFromSystem(undefined)).toBe("light");
    expect(schemeFromSystem("unspecified")).toBe("light");
  });

  it("gives the matching palette and is referentially stable", () => {
    expect(themeFor("light").c).toEqual(color);
    expect(themeFor("dark").c).toEqual(nightColor);
    expect(themeFor("dark")).toBe(themeFor("dark"));
    expect(themeFor("light").scheme).toBe("light");
    expect(themeFor("dark").scheme).toBe("dark");
  });

  it("re-maps surfaces and keeps the brand hues", () => {
    expect(themeFor("dark").c.canvas).not.toBe(themeFor("light").c.canvas);
    expect(themeFor("dark").c.flame).toBe(themeFor("light").c.flame);
  });
});

describe("the tone table", () => {
  it.each(SCHEMES)("defines every tone with all four values (%s)", (scheme) => {
    const table = toneStyles(scheme);
    for (const tone of TONES) {
      const style = table[tone];
      expect(style, tone).toBeDefined();
      for (const key of ["fg", "ink", "surface", "border"] as const) {
        expect(style[key], `${tone}.${key}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
    expect(Object.keys(table).sort()).toEqual([...TONES].sort());
  });

  it("differs between schemes for the tinted tones", () => {
    for (const tone of ["neutral", "good", "warn", "info", "bad"] as const) {
      expect(toneStyles("dark")[tone].surface, tone).not.toBe(toneStyles("light")[tone].surface);
    }
  });

  it("maps every driver status tone, and the legacy tables agree with the new one", () => {
    for (const scheme of SCHEMES) {
      const legacy = toneTable(scheme);
      for (const status of ["neutral", "active", "good", "bad"] as const) {
        const tone = toneForStatus(status);
        expect(legacy[status].surface).toBe(toneStyles(scheme)[tone].surface);
        expect(legacy[status].text).toBe(toneStyles(scheme)[tone].ink);
      }
    }
  });

  it("names a badge tone and, for saved, withholds the wording for claims.ts", () => {
    expect(STOP_BADGE_SPEC.saved.label).toBeNull();
    expect(STOP_BADGE_SPEC.saved.icon).toBe("phone");
    expect(STOP_BADGE_SPEC.delivered.label).toBe("Delivered");
    expect(STOP_BADGE_SPEC.next.label).toBe("Next stop");
    expect(STOP_BADGE_SPEC.upcoming.label).toBe("Upcoming");
    for (const spec of Object.values(STOP_BADGE_SPEC)) expect(TONES).toContain(spec.tone);
  });
});

describe("contrast helper", () => {
  it("matches known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // #767676 on white is the textbook 4.54:1.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });

  it("composites translucent colours over what is underneath", () => {
    expect(compositeOver("rgba(255,255,255,0.5)", "#000000")).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });
});

describe.each(SCHEMES)("contrast, %s scheme", (scheme) => {
  const { c } = themeFor(scheme);
  const tones = toneStyles(scheme);

  it("ink on every page surface", () => {
    for (const surface of [c.canvas, c.raised, c.surface]) {
      expect(contrastRatio(c.ink, surface), `ink on ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("muted text on every page surface", () => {
    for (const surface of [c.canvas, c.raised, c.surface]) {
      expect(contrastRatio(c.muted, surface), `muted on ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("link text on the surfaces it is drawn on", () => {
    for (const surface of [c.canvas, c.surface]) {
      expect(contrastRatio(c.link, surface), `link on ${surface}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("status ink on its tone surface, every tone", () => {
    for (const tone of TONES) {
      expect(
        contrastRatio(tones[tone].ink, tones[tone].surface),
        `${tone}: ${tones[tone].ink} on ${tones[tone].surface}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it("body ink and muted text on a tinted banner or card", () => {
    for (const tone of ["good", "warn", "info", "bad"] as const) {
      expect(contrastRatio(c.ink, tones[tone].surface), `ink on ${tone}`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(c.muted, tones[tone].surface), `muted on ${tone}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("status icons on their tone surface (3:1, non-text)", () => {
    for (const tone of ["good", "warn", "info", "bad"] as const) {
      expect(contrastRatio(tones[tone].fg, tones[tone].surface), tone).toBeGreaterThanOrEqual(3);
    }
  });

  it("the dominant action: ink on flame, white on danger, muted on a disabled fill", () => {
    expect(contrastRatio(tones.accent.ink, c.flame)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(DANGER[scheme].ink, DANGER[scheme].bg)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(c.muted, c.line)).toBeGreaterThanOrEqual(AA);
  });

  it("the danger fill separates from the page (3:1, non-text)", () => {
    expect(contrastRatio(DANGER[scheme].bg, c.canvas)).toBeGreaterThanOrEqual(3);
  });
});

describe("the navy header (both schemes)", () => {
  it("white, secondary and faint text on navy", () => {
    for (const ink of [HEADER.text, HEADER.sub, HEADER.faint]) {
      expect(contrastRatio(ink, HEADER.surface), ink).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the step badge's flame text on its control fill over navy", () => {
    expect(contrastRatio(color.flame, HEADER.control, HEADER.surface)).toBeGreaterThanOrEqual(AA);
  });

  it("each connectivity chip's word on its fill, over navy", () => {
    for (const label of ["Checking", "Connected", "Offline"] as const) {
      const chip = CHIP_ON_NAVY[label];
      expect(contrastRatio(chip.ink, chip.surface, HEADER.surface), label).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(chip.dot, chip.surface, HEADER.surface), `${label} dot`).toBeGreaterThanOrEqual(3);
    }
  });

  it("white on the solid red 'Can't deliver' badge", () => {
    expect(contrastRatio(DANGER.dark.ink, DANGER.dark.bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe("step tracker and progress", () => {
  it("marks earlier steps done, the step current, later steps todo", () => {
    expect(stepTrackerState(1)).toEqual(["current", "todo", "todo"]);
    expect(stepTrackerState(2)).toEqual(["done", "current", "todo"]);
    expect(stepTrackerState(3)).toEqual(["done", "done", "current"]);
    expect(stepTrackerState("done")).toEqual(["done", "done", "done"]);
  });

  it("labels the badge", () => {
    expect(stepBadgeLabel(2)).toBe("Step 2 of 3");
    expect(stepBadgeLabel("done")).toBe("Done");
  });

  it("computes whole percents without NaN or overflow", () => {
    expect(progressPercent(1, 4)).toBe(25);
    expect(progressPercent(2, 4)).toBe(50);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5, 4)).toBe(100);
    expect(progressPercent(-1, 4)).toBe(0);
  });

  it("words the progress line", () => {
    expect(progressLabel(1, 4)).toBe("1 of 4 stops completed");
    expect(progressLabel(1, 1)).toBe("1 of 1 stop completed");
  });
});

describe("counting", () => {
  it("nudges within bounds", () => {
    expect(nudgeCount(5, -1, 0, 24)).toBe(4);
    expect(nudgeCount(0, -1, 0, 24)).toBe(0);
    expect(nudgeCount(24, 1, 0, 24)).toBe(24);
    expect(nudgeCount(24, 1, 0)).toBe(25);
  });

  it("parses a typed count, clamping, and refuses what is not a whole number", () => {
    expect(parseCount("12", 0, 24)).toBe(12);
    expect(parseCount(" 7 ", 0, 24)).toBe(7);
    expect(parseCount("99", 0, 24)).toBe(24);
    expect(parseCount("0", 0, 24)).toBe(0);
    expect(parseCount("", 0, 24)).toBeNull();
    expect(parseCount("-3", 0, 24)).toBeNull();
    expect(parseCount("2.5", 0, 24)).toBeNull();
    expect(parseCount("abc", 0, 24)).toBeNull();
    expect(parseCount("1234567", 0)).toBeNull();
  });
});

describe("insets", () => {
  it("uses the real status bar height on Android and never less than a floor", () => {
    expect(computeInsets("android", 36).top).toBe(36);
    expect(computeInsets("android", undefined).top).toBeGreaterThanOrEqual(24);
    expect(computeInsets("android", 0).top).toBeGreaterThanOrEqual(24);
  });

  it("is conservative on iOS", () => {
    expect(computeInsets("ios", undefined).top).toBeGreaterThanOrEqual(44);
  });
});

describe("icons", () => {
  const required = [
    "check", "clock", "pin", "clipboard", "play", "warning", "wifi", "wifi-off", "swap", "doc",
    "phone", "bulb", "camera", "plus", "retake", "chevron-right", "chevron-down", "arrow-left",
    "arrow-right", "dots-vertical", "eye", "eye-off", "truck", "cloud-off", "refresh", "x",
  ];

  it("has a drawing for every required name", () => {
    for (const name of required) {
      expect(ICON_NAMES, name).toContain(name);
      expect((ICON_PATHS as Record<string, readonly unknown[]>)[name]!.length, name).toBeGreaterThan(0);
    }
  });

  it("has no map icon (the native app has no map screen)", () => {
    expect(ICON_NAMES.some((name) => name.includes("map"))).toBe(false);
  });
});

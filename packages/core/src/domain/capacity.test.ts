import { describe, expect, it } from "vitest";
import { level, percent, tighter } from "./capacity";

describe("percent", () => {
  it("rounds to whole percentages", () => {
    expect(percent(242, 270)).toBe(90);
    expect(percent(885, 1040)).toBe(85);
  });

  it("returns zero rather than dividing by zero", () => {
    expect(percent(0, 270)).toBe(0);
    expect(percent(5, 0)).toBe(0);
  });
});

describe("level", () => {
  it("treats exactly at capacity as near, not over", () => {
    // A full vehicle is legal. Calling it "over" would put a red badge on a
    // perfectly good plan.
    expect(level(270, 270)).toBe("near");
    expect(level(270.5, 270)).toBe("over");
  });

  it("agrees with the number shown beside it", () => {
    expect(level(227, 270)).toBe("ok");
    expect(level(242, 270)).toBe("near"); // reads 90%
  });

  it("treats no capacity as over", () => {
    expect(level(5, 0)).toBe("over");
  });
});

describe("tighter", () => {
  it("picks the binding constraint", () => {
    expect(tighter({ used: 4.65, cap: 7 }, { used: 885, cap: 1040 })).toBe("b");
    expect(tighter({ used: 6.62, cap: 26.4 }, { used: 1267, cap: 5510 })).toBe("a");
  });
});

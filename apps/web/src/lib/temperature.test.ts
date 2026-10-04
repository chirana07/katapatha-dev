import { describe, expect, it } from "vitest";
import { TEMPS, countTemps, isTemp, needsReefer, tempBreakdown, tempLabel } from "./temperature";

describe("temperature classes", () => {
  it("names all three and recognises only them", () => {
    expect(TEMPS).toEqual(["ambient", "chilled", "frozen"]);
    expect(TEMPS.every(isTemp)).toBe(true);
    expect(isTemp("tepid")).toBe(false);
    expect(isTemp(null)).toBe(false);
  });

  it("labels each, and reads anything else as ambient", () => {
    expect(tempLabel("chilled")).toBe("Chilled");
    expect(tempLabel("frozen")).toBe("Frozen");
    expect(tempLabel("ambient")).toBe("Ambient");
    expect(tempLabel("???")).toBe("Ambient");
  });

  it("sends chilled and frozen, not ambient, to a refrigerated vehicle", () => {
    expect(needsReefer("chilled")).toBe(true);
    expect(needsReefer("frozen")).toBe(true);
    expect(needsReefer("ambient")).toBe(false);
  });

  it("breaks a day's orders down, showing frozen only when there are some", () => {
    expect(tempBreakdown({ chilled: 7, ambient: 11 })).toBe("7 chilled · 11 ambient");
    expect(tempBreakdown({ chilled: 7, frozen: 2, ambient: 11 })).toBe("7 chilled · 2 frozen · 11 ambient");
    expect(tempBreakdown({})).toBe("0 chilled · 0 ambient");
  });

  it("counts items by class, ignoring a class it does not know", () => {
    expect(
      countTemps([{ tempRequirement: "chilled" }, { tempRequirement: "frozen" }, { tempRequirement: "chilled" }, { tempRequirement: "odd" }]),
    ).toEqual({ ambient: 0, chilled: 2, frozen: 1 });
  });
});

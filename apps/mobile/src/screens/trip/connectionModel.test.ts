import { describe, expect, it } from "vitest";
import { clockDifferenceLine, connectionPill, serverSwitchedNote } from "./connectionModel";

describe("the Connection card", () => {
  it("pairs each of the three labels with a tone and a glyph", () => {
    expect(connectionPill("Connected")).toEqual({ tone: "good", icon: "wifi" });
    expect(connectionPill("Offline")).toEqual({ tone: "warn", icon: "wifi-off" });
    expect(connectionPill("Checking")).toEqual({ tone: "neutral", icon: "wifi" });
  });

  it("states the clock difference without a verdict", () => {
    expect(clockDifferenceLine(null)).toBeNull();
    expect(clockDifferenceLine(-90_500)).toBe("Clock differs from the server by 91s");
    expect(clockDifferenceLine(4_000)).toBe("Clock differs from the server by 4s");
  });

  it("names the server it switched to", () => {
    expect(serverSwitchedNote("http://10.0.0.2:3201/v1")).toBe("Now using http://10.0.0.2:3201/v1.");
  });
});

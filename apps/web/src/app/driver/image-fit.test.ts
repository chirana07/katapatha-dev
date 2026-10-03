import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  API_PAGE_LIMIT_CHARS,
  FIT_STEPS,
  MAX_POD_PAGES,
  TARGET_PAGE_CHARS,
  byteLabel,
  canAddPage,
  fitWithin,
  fitsPage,
} from "./image-fit";

describe("Proof-of-delivery page sizing", () => {
  it("scales the long edge down and keeps the aspect ratio", () => {
    assert.deepEqual(fitWithin(4000, 3000, 2000), { width: 2000, height: 1500 });
    assert.deepEqual(fitWithin(3000, 4000, 2000), { width: 1500, height: 2000 });
  });

  it("never enlarges an image that already fits", () => {
    assert.deepEqual(fitWithin(800, 600, 2000), { width: 800, height: 600 });
  });

  it("refuses a degenerate size rather than returning NaN", () => {
    assert.deepEqual(fitWithin(0, 100, 500), { width: 0, height: 0 });
  });

  it("never rounds a very thin image down to zero pixels", () => {
    assert.equal(fitWithin(10000, 1, 100).height, 1);
  });

  it("tries gentler settings before harsher ones", () => {
    for (let i = 1; i < FIT_STEPS.length; i++) {
      assert.ok(FIT_STEPS[i]!.maxEdge < FIT_STEPS[i - 1]!.maxEdge);
      assert.ok(FIT_STEPS[i]!.quality < FIT_STEPS[i - 1]!.quality);
    }
  });

  it("aims below the API's limit, not at it", () => {
    assert.ok(TARGET_PAGE_CHARS < API_PAGE_LIMIT_CHARS);
    assert.equal(fitsPage("x".repeat(TARGET_PAGE_CHARS)), true);
    assert.equal(fitsPage("x".repeat(TARGET_PAGE_CHARS + 1)), false);
  });

  it("caps the page count at the API's eight", () => {
    assert.equal(MAX_POD_PAGES, 8);
    assert.equal(canAddPage(7), true);
    assert.equal(canAddPage(8), false);
  });

  it("labels sizes for the driver", () => {
    assert.equal(byteLabel(3_400_000), "3.4 MB");
    assert.equal(byteLabel(820_000), "820 KB");
  });
});

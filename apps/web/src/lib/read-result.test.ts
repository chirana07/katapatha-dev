import { describe, expect, it } from "vitest";
import { readOf } from "./read-result";

describe("readOf", () => {
  it("passes data through", async () => {
    const result = await readOf(Promise.resolve({ data: { n: 1 }, response: { status: 200 } }));
    expect(result).toEqual({ ok: true, data: { n: 1 }, status: 200 });
  });

  it("keeps the API's own code and message on a refusal", async () => {
    const result = await readOf(
      Promise.resolve({
        error: { error: { code: "NOTE_REQUIRED", message: "Needs a note.", details: { a: 1 } } },
        response: { status: 422 },
      }),
    );
    expect(result).toEqual({ ok: false, status: 422, code: "NOTE_REQUIRED", message: "Needs a note.", details: { a: 1 } });
  });

  it("reports a thrown network failure as status 0", async () => {
    const result = await readOf(Promise.reject(new TypeError("fetch failed")));
    expect(result).toMatchObject({ ok: false, status: 0, code: null });
  });

  it("does not mistake an empty-bodied error for success", async () => {
    const result = await readOf(Promise.resolve({ error: undefined, data: undefined, response: { status: 500 } }));
    expect(result).toMatchObject({ ok: false, status: 500 });
  });
});

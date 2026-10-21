import { afterEach, describe, expect, test } from "bun:test";
import { linearTracker } from "./linear.ts";

describe("linear comments", () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });
  test("returns the comments oldest first, author unknown without a user", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          data: {
            issue: {
              comments: {
                nodes: [
                  { body: "newer", createdAt: "2026-01-02T00:00:00.000Z", user: { name: "bob" } },
                  { body: "older", createdAt: "2026-01-01T00:00:00.000Z", user: null },
                ],
              },
            },
          },
        }),
      { preconnect: saved.preconnect },
    );
    const tracker = linearTracker({ kind: "linear", api_key: "k" });
    const found = await tracker.comments("T-1");
    expect(found).toEqual([
      { author: "unknown", date: "2026-01-01T00:00:00.000Z", body: "older" },
      { author: "bob", date: "2026-01-02T00:00:00.000Z", body: "newer" },
    ]);
  });
});

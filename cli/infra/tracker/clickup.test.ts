import { afterEach, describe, expect, test } from "bun:test";
import { type ClickupStatus, clickupTracker, pickStatus } from "./clickup.ts";

const LIST_ID = "901";
const statuses: ClickupStatus[] = [
  { status: "Complete", type: "closed", orderindex: 4 },
  { status: "In Progress", type: "custom", orderindex: 2 },
  { status: "In Review", type: "custom", orderindex: 3 },
  { status: "Open", type: "open", orderindex: 0 },
];

describe("pickStatus", () => {
  test("in progress is the custom status with the lowest orderindex", () => {
    expect(pickStatus({ statuses, status: "in_progress", names: {}, listId: LIST_ID })).toBe(
      "In Progress",
    );
  });
  test("done is the closed status", () => {
    expect(pickStatus({ statuses, status: "done", names: {}, listId: LIST_ID })).toBe("Complete");
  });
  test("a list without a custom status gives no in progress status", () => {
    const plain = statuses.filter((s) => s.type !== "custom");
    const pick = () =>
      pickStatus({ statuses: plain, status: "in_progress", names: {}, listId: LIST_ID });
    expect(pick).toThrow(/no in_progress status in list 901/);
  });
  test("a configured name wins over the type rule, ignoring case", () => {
    const names = { in_progress: "In Review" };
    expect(pickStatus({ statuses, status: "in_progress", names, listId: LIST_ID })).toBe(
      "In Review",
    );
  });
  test("an unknown configured name lists the statuses of the list", () => {
    const names = { done: "doing" };
    const pick = () => pickStatus({ statuses, status: "done", names, listId: LIST_ID });
    expect(pick).toThrow(
      'ClickUp: no status "doing" in list 901; it has: Open, In Progress, In Review, Complete',
    );
  });
});

describe("clickupTracker", () => {
  const saved = process.env.CLICKUP_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLICKUP_API_KEY;
    else process.env.CLICKUP_API_KEY = saved;
  });
  test("without a key it fails with the tracker-auth error", () => {
    delete process.env.CLICKUP_API_KEY;
    expect(() => clickupTracker({ kind: "clickup" })).toThrow(
      "ClickUp: set tracker.api_key in tenbox.local.yaml or CLICKUP_API_KEY",
    );
  });
});

describe("clickup comment", () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });
  test("posts the text to the task's comment endpoint", async () => {
    const calls: { url: string; body: string }[] = [];
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return Response.json({ id: 1 });
      },
      { preconnect: saved.preconnect },
    );
    const tracker = clickupTracker({ kind: "clickup", api_key: "k" });
    await tracker.comment({ id: "abc", text: "5 min, 1k tokens, 2 rounds" });
    expect(calls).toEqual([
      {
        url: "https://api.clickup.com/api/v2/task/abc/comment",
        body: '{"comment_text":"5 min, 1k tokens, 2 rounds"}',
      },
    ]);
  });
});

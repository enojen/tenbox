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
  test("in progress is the status named in progress, not the first custom one", () => {
    const todoFirst: ClickupStatus[] = [
      { status: "to do", type: "custom", orderindex: 1 },
      ...statuses,
    ];
    expect(
      pickStatus({ statuses: todoFirst, status: "in_progress", names: {}, listId: LIST_ID }),
    ).toBe("In Progress");
  });
  test("done is the status named done, ignoring case", () => {
    const withDone: ClickupStatus[] = [
      ...statuses,
      { status: "DONE", type: "closed", orderindex: 5 },
    ];
    expect(pickStatus({ statuses: withDone, status: "done", names: {}, listId: LIST_ID })).toBe(
      "DONE",
    );
  });
  test("without a matching name it lists the statuses and shows the setting", () => {
    const pick = () => pickStatus({ statuses, status: "done", names: {}, listId: LIST_ID });
    expect(pick).toThrow(
      'ClickUp: no status "done" in list 901; it has: Open, In Progress, In Review, Complete; set tracker.statuses, for example { done: "<status name>" }',
    );
  });
  test("a configured name wins over the default name, ignoring case", () => {
    const names = { in_progress: "In Review" };
    expect(pickStatus({ statuses, status: "in_progress", names, listId: LIST_ID })).toBe(
      "In Review",
    );
  });
  test("an unknown configured name lists the statuses of the list", () => {
    const names = { done: "doing" };
    const pick = () => pickStatus({ statuses, status: "done", names, listId: LIST_ID });
    expect(pick).toThrow(
      'ClickUp: no status "doing" in list 901; it has: Open, In Progress, In Review, Complete; set tracker.statuses, for example { done: "<status name>" }',
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

describe("clickup updateStatus", () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });
  test("returns the real status name it set", async () => {
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request) => {
        const path = String(url);
        if (path.includes("/list/")) return Response.json({ statuses });
        return Response.json({
          id: "abc",
          name: "t",
          markdown_description: null,
          url: "u",
          status: { status: "Open" },
          list: { id: LIST_ID },
        });
      },
      { preconnect: saved.preconnect },
    );
    const tracker = clickupTracker({ kind: "clickup", api_key: "k" });
    const name = await tracker.updateStatus("abc", "in_progress");
    expect(name).toBe("In Progress");
  });
});

describe("clickup comments", () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });
  test("reads the comment endpoint, oldest first, ISO dates", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request) => {
        urls.push(String(url));
        return Response.json({
          comments: [
            { comment_text: "newer", user: { username: "bob" }, date: "1767312000000" },
            { comment_text: "older", user: { username: "ann" }, date: "1767225600000" },
          ],
        });
      },
      { preconnect: saved.preconnect },
    );
    const tracker = clickupTracker({ kind: "clickup", api_key: "k" });
    const found = await tracker.comments("abc");
    expect(urls).toEqual(["https://api.clickup.com/api/v2/task/abc/comment"]);
    expect(found).toEqual([
      { author: "ann", date: "2026-01-01T00:00:00.000Z", body: "older" },
      { author: "bob", date: "2026-01-02T00:00:00.000Z", body: "newer" },
    ]);
  });
});

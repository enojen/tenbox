import { afterEach, describe, expect, test } from "bun:test";
import { makeTracker } from "./index.ts";
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

describe("linear updateStatus", () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });
  test("queued and review are skipped without a request", async () => {
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls += 1;
        return Response.json({});
      },
      { preconnect: saved.preconnect },
    );
    const tracker = linearTracker({ kind: "linear", api_key: "k" });
    const queued = await tracker.updateStatus("T-1", "queued");
    const review = await tracker.updateStatus("T-1", "review");
    expect([queued, review]).toEqual(["skipped", "skipped"]);
    expect(calls).toBe(0);
  });
});

describe("linear new tasks", () => {
  const saved = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = saved;
  });

  /** Answers each GraphQL request with the next `data`, and keeps the requests. */
  function answerEach(answers: unknown[]): { requests: Record<string, unknown>[] } {
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ data: answers[requests.length - 1] });
      },
      { preconnect: saved.preconnect },
    );
    return { requests };
  }

  test("findOpen asks for the open issue of the team with exactly the title", async () => {
    const { requests } = answerEach([
      { issues: { nodes: [{ identifier: "TEN-7", url: "https://linear.app/t/issue/TEN-7" }] } },
    ]);
    const tracker = linearTracker({ kind: "linear", api_key: "k", team: "TEN" });
    const found = await tracker.findOpen("Add login");
    expect(found).toEqual({ id: "TEN-7", url: "https://linear.app/t/issue/TEN-7" });
    expect(requests[0]?.variables).toEqual({ team: "TEN", title: "Add login" });
  });

  test("create finds the team, makes a missing label, and writes the issue", async () => {
    const { requests } = answerEach([
      { teams: { nodes: [{ id: "team-1" }] } },
      { issueLabels: { nodes: [{ id: "label-feature" }] } },
      { issueLabels: { nodes: [] } },
      { issueLabelCreate: { issueLabel: { id: "label-agent" } } },
      { issueCreate: { issue: { identifier: "TEN-9", url: "https://linear.app/t/issue/TEN-9" } } },
    ]);
    const tracker = linearTracker({ kind: "linear", api_key: "k", team: "TEN" });
    const made = await tracker.create({
      title: "T",
      body: "**Why**\nx",
      labels: ["feature", "agent"],
    });
    expect(made).toEqual({ id: "TEN-9", url: "https://linear.app/t/issue/TEN-9" });
    expect(requests[3]?.variables).toEqual({ name: "agent", teamId: "team-1" });
    expect(requests[4]?.variables).toEqual({
      teamId: "team-1",
      title: "T",
      description: "**Why**\nx",
      labelIds: ["label-feature", "label-agent"],
    });
  });

  test("without tracker.team, create and findOpen refuse with tracker and name the setting", async () => {
    answerEach([]);
    const tracker = linearTracker({ kind: "linear", api_key: "k" });
    const message = "Linear: set tracker.team to the key of the team, for example TEN";
    await expect(tracker.create({ title: "T", body: "b", labels: [] })).rejects.toThrow(message);
    await expect(tracker.findOpen("T")).rejects.toThrow(message);
  });

  test("--list is the key of the team the issue goes to", async () => {
    const { requests } = answerEach([{ issues: { nodes: [] } }]);
    const tracker = makeTracker({ kind: "linear", api_key: "k", team: "TEN" }, { list: "OPS" });
    await tracker.findOpen("T");
    expect(requests[0]?.variables).toEqual({ team: "OPS", title: "T" });
  });

  test("--parent writes a sub-issue: the parent's id goes to parentId", async () => {
    const parent = {
      id: "uuid-parent",
      identifier: "TEN-3",
      title: "Parent",
      description: null,
      url: "https://linear.app/t/issue/TEN-3",
      state: { name: "Todo", type: "unstarted" },
      team: { id: "team-1", states: { nodes: [] } },
    };
    const { requests } = answerEach([
      { teams: { nodes: [{ id: "team-1" }] } },
      { issue: parent },
      { issueCreate: { issue: { identifier: "TEN-9", url: "https://linear.app/t/issue/TEN-9" } } },
    ]);
    const tracker = makeTracker({ kind: "linear", api_key: "k", team: "TEN" }, { parent: "TEN-3" });
    await tracker.create({ title: "T", body: "b", labels: [] });
    expect(requests[1]?.variables).toEqual({ id: "TEN-3" });
    expect(requests[2]?.variables).toEqual({
      teamId: "team-1",
      title: "T",
      description: "b",
      labelIds: [],
      parentId: "uuid-parent",
    });
  });
});

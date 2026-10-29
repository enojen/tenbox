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
});

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { processes } from "../processes.ts";
import { githubTracker } from "./github.ts";

type Run = typeof processes.run;

const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: "", timedOut: false });

describe("github tracker", () => {
  const calls: string[][] = [];
  afterEach(() => {
    calls.length = 0;
  });

  function answer(reply: (args: string[]) => ReturnType<Run>): void {
    spyOn(processes, "run").mockImplementation((cmd) => {
      calls.push(cmd);
      return reply(cmd);
    });
  }

  test("getTask reads the issue by number with gh issue view", async () => {
    answer(() =>
      ok(
        JSON.stringify({
          number: 23,
          title: "Add tenbox login",
          body: "**Why**\nx",
          url: "https://github.com/o/r/issues/23",
          state: "OPEN",
        }),
      ),
    );
    const task = await githubTracker.getTask("23");
    expect(task).toEqual({
      id: "23",
      title: "Add tenbox login",
      description: "**Why**\nx",
      url: "https://github.com/o/r/issues/23",
      status: "OPEN",
    });
    expect(calls).toEqual([["gh", "issue", "view", "23", "--json", "number,title,body,url,state"]]);
  });

  test("getTask fails with the gh message when the issue is not found", async () => {
    answer(() =>
      Promise.resolve({
        code: 1,
        stdout: "",
        stderr: "Could not resolve to an issue",
        timedOut: false,
      }),
    );
    await expect(githubTracker.getTask("999")).rejects.toThrow(
      "GitHub: gh issue view: Could not resolve to an issue",
    );
  });

  test("in progress leaves the issue open and reports its state", async () => {
    answer(() => ok(JSON.stringify({ number: 23, title: "t", body: "", url: "u", state: "OPEN" })));
    const shown = await githubTracker.updateStatus("23", "in_progress");
    expect(shown).toBe("OPEN");
    expect(calls.map((c) => c[2])).toEqual(["view"]);
  });

  test("done closes an open issue", async () => {
    answer((args) =>
      args[2] === "view"
        ? ok(JSON.stringify({ number: 23, title: "t", body: "", url: "u", state: "OPEN" }))
        : ok(""),
    );
    const shown = await githubTracker.updateStatus("23", "done");
    expect(shown).toBe("CLOSED");
    expect(calls.map((c) => c[2])).toEqual(["view", "close"]);
  });

  test("done on a closed issue closes nothing", async () => {
    answer(() =>
      ok(JSON.stringify({ number: 23, title: "t", body: "", url: "u", state: "CLOSED" })),
    );
    const shown = await githubTracker.updateStatus("23", "done");
    expect(shown).toBe("CLOSED");
    expect(calls.map((c) => c[2])).toEqual(["view"]);
  });

  test("comment posts the text with gh issue comment", async () => {
    answer(() => ok(""));
    await githubTracker.comment({ id: "23", text: "12 min, 3k tokens, 1 rounds" });
    expect(calls).toEqual([
      ["gh", "issue", "comment", "23", "--body", "12 min, 3k tokens, 1 rounds"],
    ]);
  });

  test("comments come back oldest first with the author login", async () => {
    answer(() =>
      ok(
        JSON.stringify({
          comments: [
            { author: { login: "bob" }, body: "newer", createdAt: "2026-01-02T00:00:00Z" },
            { author: { login: "ann" }, body: "older", createdAt: "2026-01-01T00:00:00Z" },
          ],
        }),
      ),
    );
    const found = await githubTracker.comments("23");
    expect(found).toEqual([
      { author: "ann", date: "2026-01-01T00:00:00Z", body: "older" },
      { author: "bob", date: "2026-01-02T00:00:00Z", body: "newer" },
    ]);
  });

  test("an output that does not fit is a tracker error", async () => {
    answer(() => ok('{"number":"x"}'));
    await expect(githubTracker.getTask("23")).rejects.toThrow("GitHub: gh output does not fit");
  });
});

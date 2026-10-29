import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { processes } from "../processes.ts";
import { githubIssues, githubTracker } from "./github.ts";

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
      "gh issue view failed: Could not resolve to an issue",
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

  test("an output that does not fit is a gh error", async () => {
    answer(() => ok('{"number":"x"}'));
    await expect(githubTracker.getTask("23")).rejects.toThrow(
      "gh issue view failed: output does not fit",
    );
  });
});

describe("github tracker: new tasks", () => {
  const calls: string[][] = [];
  afterEach(() => {
    calls.length = 0;
  });

  /** One stdout per gh call, in order. */
  function answerEach(outputs: string[]): void {
    spyOn(processes, "run").mockImplementation((cmd) => {
      calls.push(cmd);
      return ok(outputs[calls.length - 1] ?? "");
    });
  }

  const listed = JSON.stringify([
    { number: 7, title: "Add Tenbox Login", url: "https://github.com/o/r/issues/7" },
    { number: 8, title: "Add tenbox login page", url: "https://github.com/o/r/issues/8" },
  ]);

  test("findOpen searches the open issues by title and matches the whole title, ignoring case", async () => {
    answerEach([listed]);
    const found = await githubTracker.findOpen("add tenbox login");
    expect(found).toEqual({ id: "7", url: "https://github.com/o/r/issues/7" });
    expect(calls).toEqual([
      [
        "gh",
        "issue",
        "list",
        "--state",
        "open",
        "--search",
        "in:title add tenbox login",
        "--limit",
        "100",
        "--json",
        "number,title,url",
      ],
    ]);
  });

  test("findOpen is null when no open issue has exactly the title", async () => {
    answerEach([listed]);
    const found = await githubTracker.findOpen("Add tenbox");
    expect(found).toBeNull();
  });

  test("create makes the labels the repository lacks, then the issue, and returns its number", async () => {
    const labels = JSON.stringify([{ name: "feature" }]);
    answerEach(["true", labels, "", "https://github.com/o/r/issues/9"]);
    const task = { title: "T", body: "**Why**\nx", labels: ["feature", "agent"] };
    const made = await githubTracker.create(task);
    expect(made).toEqual({ id: "9", url: "https://github.com/o/r/issues/9" });
    expect(calls).toEqual([
      ["gh", "api", "repos/{owner}/{repo}", "--jq", ".permissions.push"],
      ["gh", "label", "list", "--limit", "100", "--json", "name"],
      ["gh", "label", "create", "agent"],
      [
        "gh",
        "issue",
        "create",
        "--title",
        "T",
        "--body",
        "**Why**\nx",
        "--label",
        "feature",
        "--label",
        "agent",
      ],
    ]);
  });

  test("without push access, create sets no label and names them on the first line of the body", async () => {
    answerEach(["false", "https://github.com/o/r/issues/9"]);
    const task = { title: "T", body: "**Why**\nx", labels: ["bug", "agent"] };
    await githubTracker.create(task);
    expect(calls).toEqual([
      ["gh", "api", "repos/{owner}/{repo}", "--jq", ".permissions.push"],
      [
        "gh",
        "issue",
        "create",
        "--title",
        "T",
        "--body",
        "Suggested labels: bug, agent\n\n**Why**\nx",
      ],
    ]);
  });

  test("create fails with gh when the output is not an issue URL", async () => {
    answerEach(["true", "[]", "done"]);
    await expect(githubTracker.create({ title: "T", body: "b", labels: [] })).rejects.toThrow(
      "gh issue create failed: not an issue URL: done",
    );
  });

  test("the issues of a named repository pass --repo to every gh call", async () => {
    answerEach(["[]", "true", "[]", "https://github.com/enojen/tenbox/issues/95"]);
    const upstream = githubIssues("enojen/tenbox");
    const found = await upstream.findOpen("T");
    const made = await upstream.create({ title: "T", body: "b", labels: [] });
    expect(found).toBeNull();
    expect(made.id).toBe("95");
    expect(calls[1]).toEqual(["gh", "api", "repos/enojen/tenbox", "--jq", ".permissions.push"]);
    for (const call of calls) {
      if (call[1] !== "api") expect(call.slice(-2)).toEqual(["--repo", "enojen/tenbox"]);
    }
  });
});

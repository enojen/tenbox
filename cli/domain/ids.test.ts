import { describe, expect, test } from "bun:test";
import { shortSha, taskBranch, taskId, tmuxSessionName } from "./ids.ts";
import { NamesSchema } from "./manifest.ts";

const defaults = NamesSchema.parse({});

describe("taskId", () => {
  test("accepts tracker ids", () => {
    for (const id of ["TEN-301", "86abc123", "DEMO-1", "a_b"]) expect(String(taskId(id))).toBe(id);
  });
  test("rejects ids unsafe for git, tmux or the shell", () => {
    for (const id of ["", "-x", "a b", "a/b", "a;b", "a.b", "a:b"]) expect(() => taskId(id)).toThrow();
  });
  test("derives names from the defaults", () => {
    expect(taskBranch(defaults, taskId("TEN-1"))).toBe("feat/TEN-1");
    expect(tmuxSessionName(defaults, taskId("TEN-1"))).toBe("tenbox-TEN-1");
  });
  test("derives names from custom templates", () => {
    const names = NamesSchema.parse({ branch: "task/{id}-work", tmux: "{id}" });
    expect(taskBranch(names, taskId("TEN-1"))).toBe("task/TEN-1-work");
    expect(tmuxSessionName(names, taskId("TEN-1"))).toBe("TEN-1");
  });
});

describe("shortSha", () => {
  test("keeps the first seven characters", () => {
    expect(shortSha("d".repeat(40))).toBe("ddddddd");
  });
});

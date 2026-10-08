import { describe, expect, test } from "bun:test";
import {
  isProjectId,
  newProjectId,
  projectId,
  shortSha,
  taskBranch,
  taskId,
  tmuxSessionName,
} from "./ids.ts";
import { NamesSchema } from "./manifest.ts";

const defaults = NamesSchema.parse({});

describe("taskId", () => {
  test("accepts tracker ids", () => {
    for (const id of ["TEN-301", "86abc123", "DEMO-1", "a_b"]) expect(String(taskId(id))).toBe(id);
  });
  test("rejects ids unsafe for git, tmux or the shell", () => {
    for (const id of ["", "-x", "a b", "a/b", "a;b", "a.b", "a:b"])
      expect(() => taskId(id)).toThrow();
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

const SAMPLE_COUNT = 20;

describe("projectId", () => {
  test("accepts 6 characters, a-z and 0-9", () => {
    expect(String(projectId("k7f3qa"))).toBe("k7f3qa");
    expect(isProjectId("000000")).toBe(true);
  });
  test("newProjectId makes a valid id each time", () => {
    const ids = Array.from({ length: SAMPLE_COUNT }, () => newProjectId());
    expect(ids.every(isProjectId)).toBe(true);
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
  test("rejects anything else", () => {
    for (const id of ["K7F3QA", "k7f3q", "k7f3qa1", "k7-3qa", ""]) {
      expect(isProjectId(id)).toBe(false);
      expect(() => projectId(id)).toThrow();
    }
  });
});

describe("shortSha", () => {
  test("keeps the first seven characters", () => {
    expect(shortSha("d".repeat(40))).toBe("ddddddd");
  });
});

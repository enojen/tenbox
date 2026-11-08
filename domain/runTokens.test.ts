import { describe, expect, test } from "bun:test";
import { githubRepo, runTokenSecret } from "./runTokens.ts";

describe("githubRepo", () => {
  test("reads github.com/<owner>/<name>", () => {
    expect(githubRepo("github.com/enojen/tenbox-demo")).toEqual({
      owner: "enojen",
      name: "tenbox-demo",
    });
  });
  test("reads an https URL with .git", () => {
    expect(githubRepo("https://github.com/enojen/tenbox.git")).toEqual({
      owner: "enojen",
      name: "tenbox",
    });
  });
  test("reads owner/name", () => {
    expect(githubRepo("enojen/tenyard")).toEqual({ owner: "enojen", name: "tenyard" });
  });
  test("is null for another host", () => {
    expect(githubRepo("gitlab.com/enojen/tenbox")).toBeNull();
  });
  test("is null for a path with more parts", () => {
    expect(githubRepo("github.com/enojen/tenbox/tree/main")).toBeNull();
  });
});

test("runTokenSecret names the Secret after the Job", () => {
  expect(runTokenSecret("task-demo-1-1108-160406")).toBe("task-demo-1-1108-160406-github");
});

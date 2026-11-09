import { describe, expect, test } from "bun:test";
import { githubRepo, keyTracker, runPlaceholder, runTokenSecret } from "./runTokens.ts";

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

describe("runPlaceholder", () => {
  test("is the prefix and the HMAC of the Job uid, the same each time", () => {
    const placeholder = runPlaceholder("key-1", "job-uid-1");
    expect(placeholder).toMatch(/^tbxph_[A-Za-z0-9_-]{43}$/);
    expect(runPlaceholder("key-1", "job-uid-1")).toBe(placeholder);
  });

  test("differs for another Job or another key", () => {
    const placeholder = runPlaceholder("key-1", "job-uid-1");
    expect(runPlaceholder("key-1", "job-uid-2")).not.toBe(placeholder);
    expect(runPlaceholder("key-2", "job-uid-1")).not.toBe(placeholder);
  });
});

describe("keyTracker", () => {
  test("is the tracker whose key a host takes", () => {
    expect(keyTracker("api.clickup.com")).toBe("clickup");
    expect(keyTracker("api.linear.app")).toBe("linear");
  });

  test("is null for GitHub and any other host", () => {
    expect(keyTracker("api.github.com")).toBeNull();
    expect(keyTracker("app.clickup.com")).toBeNull();
  });
});

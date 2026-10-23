import { describe, expect, test } from "bun:test";
import { projectName } from "./projects.ts";

describe("projectName", () => {
  test("tenbox.yaml project: wins", () => {
    expect(projectName("/x/api", "billing")).toBe("billing");
  });
  test("falls back to the checkout's directory name", () => {
    expect(projectName("/x/api", undefined)).toBe("api");
  });
  test("uses the parent's name when the checkout is main", () => {
    expect(projectName("/home/u/wt/tenbox-demo/main", undefined)).toBe("tenbox-demo");
  });
});

import { describe, expect, test } from "bun:test";
import { lastingBoxReason } from "./machines.ts";

describe("lastingBoxReason", () => {
  test("names a reason that does not go away by itself", () => {
    const detail =
      "the box container of the run task-ten-1-1118-101500 has not started: ErrImagePull";
    expect(lastingBoxReason(detail)).toBe("ErrImagePull");
  });

  test("is null for a box that is only slow to start", () => {
    expect(
      lastingBoxReason("the box container of the run x has not started: ContainerCreating"),
    ).toBeNull();
    expect(lastingBoxReason("the box container of the run x has not started")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { commandOutput, LOG_TAIL_LINES, logTail } from "./machines.ts";

const BOOT = "tenbox-boot: cloning\ntenbox-boot: command ended with exit code 0";

describe("commandOutput", () => {
  test("is the last top-level JSON object of the log", () => {
    const log = `${BOOT}\n{\n  "ok": true,\n  "old": 1\n}\nnoise\n{\n  "ok": true,\n  "task": "TEN-1",\n  "nested": {\n    "a": 1\n  }\n}\ntenbox-boot: oom_kill 0\n`;
    expect(commandOutput(log)).toEqual({ ok: true, task: "TEN-1", nested: { a: 1 } });
  });

  test("output is null when the log has no JSON object", () => {
    expect(commandOutput(`${BOOT}\n`)).toBeNull();
    expect(commandOutput("")).toBeNull();
  });

  test("is null when the block between the braces is not JSON", () => {
    expect(commandOutput("{\n  not json\n}\n")).toBeNull();
  });
});

describe("logTail", () => {
  test("keeps the last lines of the log", () => {
    const lines = Array.from({ length: LOG_TAIL_LINES + 5 }, (_, i) => `line ${i}`);
    const tail = logTail(`${lines.join("\n")}\n`);
    expect(tail.split("\n")).toEqual(lines.slice(-LOG_TAIL_LINES));
  });

  test("keeps a short log whole and an empty log empty", () => {
    expect(logTail(`${BOOT}\n`)).toBe(BOOT);
    expect(logTail("")).toBe("");
  });
});

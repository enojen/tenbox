import { spyOn } from "bun:test";
import type { CheckResult } from "../../domain/checks.ts";
import { readTaskFile } from "../../domain/tasks.ts";
import { files } from "../infra/files.ts";

/** The `status` in a `task.json` file; null when it is missing. */
export async function readStatus(taskJson: string): Promise<string | null> {
  const text = await files.read(taskJson);
  return text === null ? null : readTaskFile(text, taskJson).status;
}

/** A `checks.json` of round 1 with no checks; `fields` replace the defaults. */
export function checkResult(fields: Partial<CheckResult>): CheckResult {
  return {
    ok: true,
    task: "T-1",
    round: 1,
    worktree: "/wt/demo/T-1",
    commit: "c",
    base: { ref: "main", sha: "b" },
    checks: [],
    summary: "all pass",
    file: ".tenbox/rounds/1/checks.json",
    tier: "fast",
    ...fields,
  };
}

/** What `read` gave and what it wrote to stderr meanwhile. */
export interface Captured<T> {
  value: T;
  stderr: string;
}

export async function captureStderr<T>(read: () => Promise<T>): Promise<Captured<T>> {
  let stderr = "";
  const spy = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const value = await read();
    return { value, stderr };
  } finally {
    spy.mockRestore();
  }
}

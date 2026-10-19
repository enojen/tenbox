import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BUSY_ANSWER = path.join(import.meta.dir, "..", "..", "machines", "busy-answer.sh");
const WATCHDOG = path.join(
  import.meta.dir,
  "..",
  "..",
  "machines",
  "watchdog",
  "tenbox-watchdog.sh",
);

async function askDown(answer: string): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "busy-answer-"));
  const answerFile = path.join(dir, "answer");
  await writeFile(answerFile, answer);
  const script = `. "${BUSY_ANSWER}"; busy_reason "$(cat "${answerFile}")"`;
  const proc = Bun.spawn(["bash", "-c", script], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, out: out.trim() };
}

describe("machine.sh down busy answer", () => {
  test("a busy: line keeps the server and gives the reason", async () => {
    const result = await askDown("busy: 2 session(s) work\n");
    expect(result).toEqual({
      code: 0,
      out: "2 session(s) work",
    });
  });

  test.each([
    ["empty output", ""],
    ["old watchdog output without the prefix", "2 session(s) work\n"],
    ["ssh noise", "Warning: Permanently added '1.2.3.4' to the list of known hosts.\n"],
    ["an idle line", "idle for 3 min\n"],
  ])("%s counts as idle", async (_name, answer) => {
    const result = await askDown(answer);
    expect(result).toEqual({ code: 1, out: "" });
  });

  test("the watchdog prints the prefix the check expects", async () => {
    const source = await Bun.file(WATCHDOG).text();
    expect(source).toContain('echo "busy: $reason"');
  });
});

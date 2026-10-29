import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { tenbox } from "../test/cli.ts";

const LIST_TEST_TIMEOUT_MS = 60_000;
const cwd = process.cwd();

describe("tenbox help", () => {
  test("help of one command prints its full help", async () => {
    const run = await tenbox(["help", "start"], cwd);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({ ok: true, command: "start" });
    expect(run.err).toContain(String(run.json.usage));
    expect(run.err).toContain("docs, small, normal, large");
    expect(run.err).toContain("Output:");
    expect(run.err).toContain("Example:");
    expect(run.json.help).toBe(run.err.trimEnd());
  });

  test(
    "every command in the list has a help text",
    async () => {
      const list = await tenbox(["help"], cwd);
      const names = Object.keys(z.record(z.string(), z.string()).parse(list.json.commands));
      expect(names.length).toBeGreaterThan(0);
      const runs = await Promise.all(names.map((name) => tenbox(["help", name], cwd)));
      for (const run of runs) {
        expect(run.code).toBe(0);
        expect(String(run.json.help)).toContain(String(run.json.usage));
        expect(String(run.json.help)).toContain("Example:");
      }
    },
    LIST_TEST_TIMEOUT_MS,
  );

  test("help without a name keeps the list", async () => {
    const run = await tenbox(["help"], cwd);
    expect(run.code).toBe(0);
    expect(run.json.ok).toBe(true);
    expect(run.json.commands).toHaveProperty("start");
    expect(run.err).toContain("tenbox start <id>");
    expect(run.json).not.toHaveProperty("help");
  });

  test("help of an unknown command is a usage error", async () => {
    const run = await tenbox(["help", "nope"], cwd);
    expect(run.code).toBe(2);
    expect(run.json).toMatchObject({ ok: false, code: "usage" });
    expect(String(run.json.error)).toContain("nope");
  });

  test("a name of Object.prototype is an unknown command", async () => {
    for (const args of [["help", "constructor"], ["help", "__proto__"], ["toString"]]) {
      const run = await tenbox(args, cwd);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ ok: false, code: "usage" });
    }
  });
});

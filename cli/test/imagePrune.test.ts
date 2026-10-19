import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BUILD_SH = path.join(import.meta.dir, "..", "..", "machines", "packer", "build.sh");
const IMAGE_COUNT = 5;
const FAKE_TOOL = "#!/usr/bin/env bash\nexit 0\n";
const FAKE_GIT = '#!/usr/bin/env bash\n[ "$1" = rev-parse ] && echo abc1234567\nexit 0\n';

type ApiMode = "ok" | "list-fails" | "delete-fails";

interface BuildRun {
  code: number;
  err: string;
  deleted: string[];
}

let binDir = "";

beforeEach(async () => {
  binDir = await mkdtemp(path.join(tmpdir(), "tenbox-prune-"));
  await writeFile(path.join(binDir, "packer"), FAKE_TOOL);
  await writeFile(path.join(binDir, "git"), FAKE_GIT);
  await chmod(path.join(binDir, "packer"), 0o755);
  await chmod(path.join(binDir, "git"), 0o755);
});

afterEach(async () => {
  await rm(binDir, { recursive: true, force: true });
});

/** Newest first, as the Hetzner list with sort=created:desc returns them. */
function snapshots(): { id: number }[] {
  return Array.from({ length: IMAGE_COUNT }, (_, i) => ({ id: IMAGE_COUNT - i }));
}

async function runBuild(mode: ApiMode, env: Record<string, string>): Promise<BuildRun> {
  const deleted: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "DELETE") {
        deleted.push(url.pathname.split("/").pop() ?? "");
        return mode === "delete-fails" ? new Response("boom", { status: 500 }) : new Response("{}");
      }
      if (mode === "list-fails") return new Response("boom", { status: 500 });
      return Response.json({ images: snapshots() });
    },
  });
  try {
    const proc = Bun.spawn(["bash", BUILD_SH, "main"], {
      env: {
        ...process.env,
        ...env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        HCLOUD_TOKEN: "t",
        HCLOUD_API_URL: `http://localhost:${server.port}/v1/images`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    return { code, err, deleted };
  } finally {
    await server.stop(true);
  }
}

describe("build.sh snapshot pruning", () => {
  test("deletes only the oldest images beyond KEEP_IMAGES (default 3)", async () => {
    const run = await runBuild("ok", {});
    expect(run.code).toBe(0);
    expect(run.deleted).toEqual(["2", "1"]);
  });

  test("KEEP_IMAGES changes how many are kept", async () => {
    const run = await runBuild("ok", { KEEP_IMAGES: "4" });
    expect(run.deleted).toEqual(["1"]);
  });

  test("a failing list leaves exit code 0 and prints a note", async () => {
    const run = await runBuild("list-fails", {});
    expect(run.code).toBe(0);
    expect(run.err).toContain("note: could not prune old images");
  });

  test("a failing delete leaves exit code 0 and prints a note", async () => {
    const run = await runBuild("delete-fails", {});
    expect(run.code).toBe(0);
    expect(run.err).toContain("note: could not prune old images");
  });
});

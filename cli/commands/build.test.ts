import { afterEach, describe, expect } from "bun:test";
import { chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { taskId } from "../../domain/ids.ts";
import { tmuxDir } from "../../domain/project.ts";
import { manifests } from "../application/manifests.ts";
import { files } from "../infra/files.ts";
import { type CliRun, removeServers, tenbox, tmux, tmuxTest, waitForText } from "../test/cli.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";

const EXECUTABLE = 0o755;

let project: TempProject;
let bin: string;
const servers: string[] = [];

/** A fake `claude`: it writes every line it reads to `<root>/out/<task id>.lines`. */
async function setup(): Promise<void> {
  project = await makeTempProject({ "tenbox.yaml": "project: demo\n", "a.txt": "a\n" });
  bin = path.join(project.root, "bin");
  const out = path.join(project.root, "out");
  await files.mkdir(out);
  const script = [
    "#!/bin/sh",
    `lines="${out}/$(basename "$PWD").lines"`,
    'while IFS= read -r line; do printf "%s\\n" "$line" >> "$lines"; done',
    "",
  ].join("\n");
  await files.write(path.join(bin, "claude"), script);
  await chmod(path.join(bin, "claude"), EXECUTABLE);
}

afterEach(async () => {
  await removeServers(servers);
  await project.remove();
});

const withFakeClaude = () => ({ PATH: `${bin}${path.delimiter}${process.env.PATH}` });
const run = (...args: string[]): Promise<CliRun> => tenbox(args, project.mainDir, withFakeClaude());
const linesFile = (id: string): string => path.join(project.root, "out", `${id}.lines`);
const planFile = (id: string): string =>
  path.join(project.wtRoot, "demo", id, ".tenbox", "plan.md");

/** Starts the task in tmux and returns its tmux server. */
async function start(id: string): Promise<string> {
  await run("start", id, "--title", "x");
  const projectId = await manifests.ensureId(project.mainDir);
  const server = tmuxDir(os.tmpdir(), projectId, taskId(id));
  servers.push(server);
  return server;
}

async function approve(id: string): Promise<void> {
  await files.write(planFile(id), "# plan\n");
  await run("approve", id);
}

/** The lines the fake `claude` of the task got, once it got at least one. */
async function waitForLines(id: string): Promise<string[]> {
  const text = await waitForText(linesFile(id));
  return text.trimEnd().split("\n");
}

describe("tenbox build", () => {
  tmuxTest("refuses an unapproved or changed plan and types nothing", async () => {
    await setup();
    await start("T-1");
    const unapproved = await run("build", "T-1");
    await approve("T-1");
    await files.write(planFile("T-1"), "# changed\n");
    const changed = await run("build", "T-1");
    expect([unapproved.code, unapproved.json.code]).toEqual([1, "not-approved"]);
    expect([changed.code, changed.json.code]).toEqual([1, "plan-changed"]);
    await approve("T-1");
    await run("build", "T-1");
    const lines = await waitForLines("T-1");
    expect(lines).toEqual(["/tenbox-build T-1"]);
  });

  tmuxTest("clears the input line and submits /tenbox-build <id>", async () => {
    await setup();
    const server = await start("T-1");
    await approve("T-1");
    tmux(["send-keys", "-t", "=tenbox-T-1:", "-l", "old text"], server);
    const built = await run("build", "T-1");
    expect([built.code, built.json]).toEqual([
      0,
      { ok: true, task: "T-1", session: "tenbox-T-1", server, sent: "/tenbox-build T-1" },
    ]);
    const lines = await waitForLines("T-1");
    expect(lines).toEqual(["/tenbox-build T-1"]);
  });

  tmuxTest("with no tmux session it is no-session and names tenbox start", async () => {
    await setup();
    await run("start", "T-1", "--title", "x", "--no-tmux");
    await approve("T-1");
    const built = await run("build", "T-1");
    expect([built.code, built.json.code]).toEqual([1, "no-session"]);
    expect(built.json.error).toContain("tenbox start T-1");
  });

  tmuxTest("each task has its own server; build reaches only its own task", async () => {
    await setup();
    const one = await start("T-1");
    const two = await start("T-2");
    expect(one).not.toBe(two);
    expect(tmux(["list-sessions", "-F", "#{session_name}"], one).stdout).toBe("tenbox-T-1");
    expect(tmux(["list-sessions", "-F", "#{session_name}"], two).stdout).toBe("tenbox-T-2");
    await approve("T-2");
    await run("build", "T-2");
    const lines = await waitForLines("T-2");
    const other = await files.read(linesFile("T-1"));
    expect(lines).toEqual(["/tenbox-build T-2"]);
    expect(other).toBeNull();
  });
});

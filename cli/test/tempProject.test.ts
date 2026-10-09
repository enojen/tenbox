import { expect, test } from "bun:test";
import { makeTempProject } from "./tempProject.ts";

test("gives the project its own tmux server and restores TMUX and TMUX_TMPDIR on remove", async () => {
  process.env.TMUX = "/user/socket,1,0";
  process.env.TMUX_TMPDIR = "/user/tmux-dir";
  const project = await makeTempProject({});
  const during = {
    tmux: process.env.TMUX ?? "unset",
    own: process.env.TMUX_TMPDIR?.startsWith(project.root),
  };
  await project.remove();
  const after = { tmux: process.env.TMUX ?? "unset", tmpdir: process.env.TMUX_TMPDIR };
  delete process.env.TMUX;
  delete process.env.TMUX_TMPDIR;
  expect(during).toEqual({ tmux: "unset", own: true });
  expect(after).toEqual({ tmux: "/user/socket,1,0", tmpdir: "/user/tmux-dir" });
});

test("restores TMUX and TMUX_TMPDIR to unset when they were unset", async () => {
  delete process.env.TMUX;
  delete process.env.TMUX_TMPDIR;
  const project = await makeTempProject({});
  await project.remove();
  expect([process.env.TMUX, process.env.TMUX_TMPDIR]).toEqual([undefined, undefined]);
});

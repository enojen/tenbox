import type { Ports } from "../ports.ts";
import { makeTracker } from "../tracker/index.ts";
import { fileBaselineStore } from "./baselines.ts";
import { clock, env, log } from "./env.ts";
import { files } from "./files.ts";
import { git, shell, tmux } from "./process.ts";

/** The real ports: the one place that wires `app/` to the operating system. */
export function realPorts(): Ports {
  const e = env();
  return { git, shell, tmux, files, baselines: fileBaselineStore(e.baselinesRoot), env: e, clock, log, tracker: makeTracker };
}

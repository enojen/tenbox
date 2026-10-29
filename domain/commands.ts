/** The tenbox CLI commands: the first word after `tenbox`. */
export const COMMAND = {
  start: "start",
  check: "check",
  worktree: "worktree",
  mergeCheck: "merge-check",
  close: "close",
  pr: "pr",
  part: "part",
  proof: "proof",
  decide: "decide",
  plan: "plan",
  build: "build",
  attach: "attach",
  hook: "hook",
  wait: "wait",
  answer: "answer",
  approve: "approve",
  approved: "approved",
  stats: "stats",
  status: "status",
  list: "list",
  machine: "machine",
  task: "task",
  report: "report",
  install: "install",
} as const;

export type CommandName = (typeof COMMAND)[keyof typeof COMMAND];

export const COMMAND_NAMES = Object.values(COMMAND);

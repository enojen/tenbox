import { type ProcessResult, processes } from "../infra/processes.ts";

/** What a fake tool answers; a missing field is an empty output or exit 0. */
export type FakeAnswer = Partial<Omit<ProcessResult, "timedOut">>;

/** A tool the CLI starts by name, answered in the test process: a fake script costs a bun start. */
export type FakeTool = (args: string[]) => FakeAnswer | Promise<FakeAnswer>;

const fakes = new Map<string, FakeTool>();
const realRun = processes.run;

processes.run = async (cmd, options) => {
  const [name = "", ...args] = cmd;
  const fake = fakes.get(name);
  if (fake === undefined) return realRun(cmd, options);
  const answer = await fake(args);
  return {
    code: answer.code ?? 0,
    stdout: answer.stdout ?? "",
    stderr: answer.stderr ?? "",
    timedOut: false,
  };
};

/** Answers `name` until the test ends; a CLI run in a process of its own does not see it. */
export function fakeTool(name: string, fake: FakeTool): void {
  fakes.set(name, fake);
}

export function clearFakeTools(): void {
  fakes.clear();
}

import path from "node:path";

export const WORKFLOW = path.join(import.meta.dir, "..", "..", "workflows", "tenbox-build.js");
const EXPORT_PREFIX = /^export /m;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/** The parts of a JSON schema the tests read. */
export interface SchemaNode {
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  maxItems?: number;
  pattern?: string;
}

export interface AgentOptions {
  agentType: string;
  label: string;
  schema?: SchemaNode;
  model?: string;
  effort?: string;
}

export type ScriptedAgent = (prompt: string, options: AgentOptions) => Promise<unknown>;

/** Runs the workflow script with a scripted agent; parallel jobs run at once. */
export async function runWorkflow(args: unknown, agent: ScriptedAgent) {
  const script = await Bun.file(WORKFLOW).text();
  const source = script.replace(EXPORT_PREFIX, "");
  const run = new AsyncFunction("args", "agent", "parallel", "phase", source);
  const parallel = (jobs: (() => Promise<unknown>)[]) => Promise.all(jobs.map((job) => job()));
  return run(args, agent, parallel, () => {});
}

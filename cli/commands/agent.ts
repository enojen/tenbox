import { agents } from "../application/agents.ts";
import type { AgentAddResult, AgentLoginResult } from "./results.ts";

/** Adds a Claude Code agent of the user in Tenport; the first one is the default. */
export async function addAgent(name: string): Promise<AgentAddResult> {
  const agent = await agents.add(name);
  return { ok: true, agent };
}

/** Sends this computer's claude.ai login to the named agent, else to the default agent. */
export async function writeAgentLogin(name: string | null): Promise<AgentLoginResult> {
  const { agent, changed } = await agents.login(name);
  return { ok: true, agent, changed };
}

import { agentExistsError, noAgentError, noLoginError } from "../../domain/errors/tools.ts";
import { claudeCredentials } from "../infra/claude/credentials.ts";
import { files } from "../infra/files.ts";
import { failedStatus } from "../infra/http.ts";
import { type Agent, tenport, type WrittenLogin } from "../infra/tenport.ts";

const HTTP_CONFLICT = 409;

/** The coding agents of the user in Tenport, and the login each one's runs use. */
export const agents = { add, login };

async function add(name: string): Promise<Agent> {
  const server = tenport.server();
  try {
    return await tenport.addAgent({ server, name });
  } catch (e) {
    if (failedStatus(e) === HTTP_CONFLICT) throw agentExistsError(name);
    throw e;
  }
}

/**
 * Sends the claude.ai login file of this computer to the agent with this name, else to the
 * default agent. The file is read before Tenport is asked, and its text is never printed.
 */
async function login(name: string | null): Promise<WrittenLogin> {
  const server = tenport.server();
  const file = claudeCredentials.file();
  const value = await files.read(file);
  if (value === null) throw noLoginError(file);
  const all = await tenport.listAgents(server);
  const agent = pickAgent(all, name);
  return tenport.writeAgentLogin({ server, agent: agent.id, value });
}

function pickAgent(all: Agent[], name: string | null): Agent {
  const agent = all.find((one) => (name === null ? one.default : one.name === name));
  if (agent === undefined) throw noAgentError(name);
  return agent;
}

import { parseArgs } from "node:util";
import { usageError } from "../../domain/errors/usage.ts";
import { projectId } from "../../domain/ids.ts";
import type { NewProject } from "../application/projects.ts";

export function readProjectAddArgs(argv: string[]): NewProject {
  const { values } = parseArgs({
    args: argv,
    options: {
      id: { type: "string" },
      name: { type: "string" },
      repo: { type: "string" },
      org: { type: "string" },
    },
    strict: true,
  });
  const { id, name, repo, org } = values;
  if (!id || !name || !repo || !org) {
    throw usageError("project add needs --id, --name, --repo and --org");
  }
  return { id: projectId(id), name, repo, org };
}

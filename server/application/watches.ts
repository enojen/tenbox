import { errorMessage } from "../../domain/errors/index.ts";

/** A failed poll of a cluster watch goes to stderr; the next poll tries again. */
function logFailure(error: unknown, what: string): void {
  console.error(`${what}: ${errorMessage(error)}`);
}

/** Watches: the cluster polls of the server, the Nodes, the Job pods and the task volumes. */
export const watches = { logFailure };

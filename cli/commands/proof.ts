import { unknownPartError } from "../../domain/errors/tasks.ts";
import { usageError } from "../../domain/errors/usage.ts";
import type { TaskId } from "../../domain/ids.ts";
import { isProof, type StatsProof, trimProof } from "../../domain/proof.ts";
import { tenboxDir } from "../../domain/task.ts";
import { parts } from "../application/parts.ts";
import { proofs } from "../application/proofs.ts";
import { worktrees } from "../application/worktrees/index.ts";
import type { ProofResult } from "./results.ts";

/** The command-line flags as given; each one must be non-blank. */
export interface ProofInput {
  id: TaskId;
  part: string | undefined;
  file: string | undefined;
  test: string | undefined;
  failure: string | undefined;
}

/** Appends one proof to the task's `.tenbox/proofs.json`. */
export async function recordProof(input: ProofInput): Promise<ProofResult> {
  const proof = readProof(input);
  const taskWorktree = await worktrees.get(input.id);
  await assertPartExists(taskWorktree, proof.part);
  const file = await proofs.append(taskWorktree, proof);
  return { ok: true, task: input.id, proof, file };
}

function readProof(input: ProofInput): StatsProof {
  const { part, file, test, failure } = input;
  const proof = { part, file, test, failure };
  if (!isProof(proof)) {
    throw usageError("--part, --file, --test and --failure each need a value");
  }
  return trimProof(proof);
}

async function assertPartExists(taskWorktree: string, part: string): Promise<void> {
  const known = await parts.read(tenboxDir(taskWorktree));
  if (!known.some((p) => p.id === part)) {
    throw unknownPartError(part);
  }
}

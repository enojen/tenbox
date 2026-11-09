import { projectNotFoundError, trackerKeyError } from "../../domain/errors/projects.ts";
import type { ProjectId } from "../../domain/ids.ts";
import type { KeyTracker } from "../../domain/runTokens.ts";
import type { Queryable } from "../infra/db/index.ts";
import { encryption } from "../infra/encryption.ts";
import { projectsRepository } from "../infra/repositories/projects.ts";

interface NewTrackerKey {
  project: ProjectId;
  tracker: KeyTracker;
  key: string;
  encryptionKey: Buffer;
}

interface SavedTrackerKey {
  project: string;
  tracker: KeyTracker;
}

interface TrackerKeyQuery {
  project: string;
  tracker: KeyTracker;
  encryptionKey: Buffer;
}

function update(db: Queryable, input: NewTrackerKey): SavedTrackerKey {
  const { project, tracker, key, encryptionKey } = input;
  if (projectsRepository.findById(db, project) === null) throw projectNotFoundError(project);
  const context = sealContext({ project, tracker });
  const sealed = encryption.seal({ key: encryptionKey, context, text: key });
  projectsRepository.updateTrackerKey(db, { id: project, tracker, sealed });
  return { project, tracker };
}

function find(db: Queryable, input: TrackerKeyQuery): string | null {
  const { project, tracker, encryptionKey } = input;
  const saved = projectsRepository.findTrackerKey(db, project);
  if (saved === null || saved.tracker !== tracker) return null;
  const context = sealContext({ project, tracker });
  const key = encryption.open({ key: encryptionKey, context, sealed: saved.sealed });
  if (key === null) throw trackerKeyError(project);
  return key;
}

function sealContext(input: SavedTrackerKey): string {
  return `${input.project}/${input.tracker}`;
}

/** The key of a project's tracker, kept sealed on its row: the box only holds a run placeholder. */
export const trackerKeys = { update, find };

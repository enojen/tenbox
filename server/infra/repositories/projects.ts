import { eq } from "drizzle-orm";
import type { KeyTracker } from "../../../domain/runTokens.ts";
import type { Queryable } from "../db/index.ts";
import { projects } from "../db/schema.ts";

export interface Project {
  id: string;
  name: string;
  repo: string;
}

interface ProjectRow extends Project {
  orgId: string;
}

interface SealedTrackerKey {
  tracker: KeyTracker;
  sealed: string;
}

interface TrackerKeyRow extends SealedTrackerKey {
  id: string;
}

const PROJECT_COLUMNS = { id: projects.id, name: projects.name, repo: projects.repo };

function findById(db: Queryable, id: string): Project | null {
  const row = db.select(PROJECT_COLUMNS).from(projects).where(eq(projects.id, id)).get();
  return row ?? null;
}

function insert(db: Queryable, row: ProjectRow): void {
  db.insert(projects).values(row).run();
}

function findTrackerKey(db: Queryable, id: string): SealedTrackerKey | null {
  const columns = { tracker: projects.tracker, sealed: projects.trackerKey };
  const row = db.select(columns).from(projects).where(eq(projects.id, id)).get();
  if (row?.tracker === undefined || row.tracker === null || row.sealed === null) return null;
  return { tracker: row.tracker, sealed: row.sealed };
}

function updateTrackerKey(db: Queryable, row: TrackerKeyRow): void {
  const { id, tracker, sealed } = row;
  db.update(projects).set({ tracker, trackerKey: sealed }).where(eq(projects.id, id)).run();
}

export const projectsRepository = { findById, insert, findTrackerKey, updateTrackerKey };

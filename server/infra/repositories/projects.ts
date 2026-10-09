import { eq } from "drizzle-orm";
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

const PROJECT_COLUMNS = { id: projects.id, name: projects.name, repo: projects.repo };

function findById(db: Queryable, id: string): Project | null {
  const row = db.select(PROJECT_COLUMNS).from(projects).where(eq(projects.id, id)).get();
  return row ?? null;
}

function insert(db: Queryable, row: ProjectRow): void {
  db.insert(projects).values(row).run();
}

export const projectsRepository = { findById, insert };

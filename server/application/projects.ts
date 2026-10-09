import { projectExistsError } from "../../domain/errors/projects.ts";
import type { ProjectId } from "../../domain/ids.ts";
import type { Db, Queryable } from "../infra/db/index.ts";
import type { Organization } from "../infra/repositories/organizations.ts";
import { type Project, projectsRepository } from "../infra/repositories/projects.ts";
import { organizations } from "./organizations.ts";

export interface NewProject {
  id: ProjectId;
  name: string;
  repo: string;
  org: string;
}

interface SavedProject {
  project: Project;
  organization: Organization;
}

function save(db: Db, input: NewProject): SavedProject {
  assertNew(db, input.id);
  const project: Project = { id: input.id, name: input.name, repo: input.repo };
  const organization = db.transaction((tx) => insert(tx, input.org, project));
  return { project, organization };
}

function assertNew(db: Queryable, id: string): void {
  if (projectsRepository.findById(db, id) !== null) throw projectExistsError(id);
}

function insert(tx: Queryable, org: string, project: Project): Organization {
  const organization = organizations.ensure(tx, org);
  projectsRepository.insert(tx, { ...project, orgId: organization.id });
  return organization;
}

/** Projects: repositories Tenbox works on, each in one organization. */
export const projects = { save };

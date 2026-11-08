export interface GitHubRepo {
  owner: string;
  name: string;
}

export const RUN_TOKEN_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  issues: "write",
} as const;

const REPO_PATTERN =
  /^(?:https:\/\/)?(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export function githubRepo(text: string): GitHubRepo | null {
  const match = REPO_PATTERN.exec(text.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { owner: match[1], name: match[2] };
}

export function runTokenSecret(job: string): string {
  return `${job}-github`;
}

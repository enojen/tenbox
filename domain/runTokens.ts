import { TRACKER_KIND } from "./manifests.ts";
import { hashes } from "./utils.ts";

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

const RUN_PLACEHOLDER_PREFIX = "tbxph_";

export const GITHUB_HOSTS: readonly string[] = ["github.com", "api.github.com"];

export const KEY_TRACKERS = [TRACKER_KIND.linear, TRACKER_KIND.clickup] as const;

export type KeyTracker = (typeof KEY_TRACKERS)[number];

const TRACKER_HOSTS: Record<KeyTracker, string> = {
  [TRACKER_KIND.linear]: "api.linear.app",
  [TRACKER_KIND.clickup]: "api.clickup.com",
};

export function keyTracker(host: string): KeyTracker | null {
  return KEY_TRACKERS.find((tracker) => TRACKER_HOSTS[tracker] === host) ?? null;
}

export function runPlaceholder(key: string, jobUid: string): string {
  return `${RUN_PLACEHOLDER_PREFIX}${hashes.hmacSha256Base64Url(key, jobUid)}`;
}

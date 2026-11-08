import crypto from "node:crypto";
import { z } from "zod";
import { type GitHubRepo, RUN_TOKEN_PERMISSIONS } from "../../domain/runTokens.ts";
import { durations } from "../../domain/utils.ts";
import { http } from "./http.ts";

const SERVICE = "github";
const JWT_BACK_SECONDS = 60;
const JWT_AHEAD_SECONDS = 540;

export interface GitHubApp {
  url: string;
  appId: string;
  key: string;
}

export interface RepoToken {
  token: string;
  expiresAt: string;
}

interface TokenRequest {
  app: GitHubApp;
  repo: GitHubRepo;
  now: Date;
}

const InstallationSchema = z.object({ id: z.number().int() });
const AccessTokenSchema = z.object({ token: z.string().min(1), expires_at: z.iso.datetime() });

async function repoToken(input: TokenRequest): Promise<RepoToken | null> {
  const { app, repo, now } = input;
  const token = appJwt(app, now);
  const installation = await http.find({
    service: SERVICE,
    url: `${app.url}/repos/${repo.owner}/${repo.name}/installation`,
    token,
    schema: InstallationSchema,
  });
  if (installation === null) return null;
  const minted = await http.post({
    service: SERVICE,
    url: `${app.url}/app/installations/${installation.id}/access_tokens`,
    token,
    schema: AccessTokenSchema,
    body: { repositories: [repo.name], permissions: RUN_TOKEN_PERMISSIONS },
  });
  return { token: minted.token, expiresAt: minted.expires_at };
}

function appJwt(app: GitHubApp, now: Date): string {
  const seconds = Math.floor(now.getTime() / durations.MS_PER_SECOND);
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const payload = base64url({
    iat: seconds - JWT_BACK_SECONDS,
    exp: seconds + JWT_AHEAD_SECONDS,
    iss: app.appId,
  });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(app.key).toString("base64url")}`;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export const github = { repoToken };

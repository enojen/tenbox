import os from "node:os";
import path from "node:path";
import { envError } from "../../domain/errors/manifest.ts";

export interface ServerEnv {
  /** `TENBOX_SERVER_HOST`, default `localhost`: loopback only, as tokens travel over plain HTTP. */
  host: string;
  /** `TENBOX_SERVER_PORT`, default 4300. */
  port: number;
  /** `TENBOX_SERVER_DB`, default `~/.tenbox-server/server.db`. */
  dbFile: string;
}

/** The Hetzner Cloud API: its base URL and a read-only token. */
export interface HetznerEnv {
  /** `HCLOUD_ENDPOINT`, default `https://api.hetzner.cloud/v1`, as the hcloud tools read it. */
  url: string;
  /** `HCLOUD_TOKEN`. */
  token: string;
}

/** The rules of the volume watch: when a closed task's volume goes, and where an idle notice goes. */
export interface VolumeEnv {
  /** `TENBOX_SERVER_VOLUME_GRACE_DAYS`, default 3: the days a closed task's volume stays. */
  graceDays: number;
  /** `TENBOX_SERVER_NTFY`, an ntfy topic URL; null when unset or blank: no idle notice. */
  ntfy: string | null;
}

/** What the node watch needs inside the cluster. */
export interface NodeWatchEnv {
  /** `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`, port default 443. */
  kubernetesUrl: string;
  hetzner: HetznerEnv;
  volumes: VolumeEnv;
}

/** One port variable, its value and the port it stands for when unset. */
interface PortInput {
  name: string;
  raw: string | undefined;
  fallback: number;
}

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 4300;
const DEFAULT_KUBERNETES_PORT = 443;
const DEFAULT_HETZNER_URL = "https://api.hetzner.cloud/v1";
const MAX_PORT = 65535;
const DEFAULT_GRACE_DAYS = 3;
const WHOLE_NUMBER = /^[0-9]+$/;
/** The ntfy topic is a secret: anyone who knows it reads the notices, so an error never shows it. */
const HIDDEN = "(not shown)";

/** Read at each call, so tests can set `process.env` first. Bun loads `.env` by itself. */
export function serverEnv(): ServerEnv {
  return {
    host: process.env.TENBOX_SERVER_HOST ?? DEFAULT_HOST,
    port: port({
      name: "TENBOX_SERVER_PORT",
      raw: process.env.TENBOX_SERVER_PORT,
      fallback: DEFAULT_PORT,
    }),
    dbFile: process.env.TENBOX_SERVER_DB ?? path.join(os.homedir(), ".tenbox-server", "server.db"),
  };
}

/**
 * Null outside a cluster: Kubernetes sets `KUBERNETES_SERVICE_HOST` in every pod. Inside one,
 * `HCLOUD_TOKEN` must be set, so a server that cannot price its nodes stops at start.
 */
export function nodeWatchEnv(): NodeWatchEnv | null {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  if (host === undefined || host === "") return null;
  const token = process.env.HCLOUD_TOKEN?.trim() ?? "";
  if (token === "") {
    throw envError("HCLOUD_TOKEN", token, "a Hetzner Cloud API token, needed inside the cluster");
  }
  const servicePort = port({
    name: "KUBERNETES_SERVICE_PORT",
    raw: process.env.KUBERNETES_SERVICE_PORT,
    fallback: DEFAULT_KUBERNETES_PORT,
  });
  return {
    kubernetesUrl: `https://${host.includes(":") ? `[${host}]` : host}:${servicePort}`,
    hetzner: { url: process.env.HCLOUD_ENDPOINT ?? DEFAULT_HETZNER_URL, token },
    volumes: volumeEnv(),
  };
}

function volumeEnv(): VolumeEnv {
  return { graceDays: graceDays(), ntfy: ntfyUrl() };
}

function graceDays(): number {
  const raw = process.env.TENBOX_SERVER_VOLUME_GRACE_DAYS;
  if (raw === undefined) return DEFAULT_GRACE_DAYS;
  if (WHOLE_NUMBER.test(raw)) return Number(raw);
  throw envError("TENBOX_SERVER_VOLUME_GRACE_DAYS", raw, "a whole number of days");
}

function ntfyUrl(): string | null {
  const raw = process.env.TENBOX_SERVER_NTFY?.trim() ?? "";
  if (raw === "") return null;
  if (URL.canParse(raw)) return raw;
  throw envError("TENBOX_SERVER_NTFY", HIDDEN, "an ntfy topic URL, <server>/<topic>");
}

function port(input: PortInput): number {
  const { name, raw, fallback } = input;
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 1 && value <= MAX_PORT) return value;
  throw envError(name, raw, `a number from 1 to ${MAX_PORT}`);
}

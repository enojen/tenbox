import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeWatchEnv, serverEnv } from "./env.ts";

const KEYS = [
  "TENBOX_SERVER_PORT",
  "TENBOX_SERVER_DB",
  "TENBOX_SERVER_HOST",
  "KUBERNETES_SERVICE_HOST",
  "KUBERNETES_SERVICE_PORT",
  "HCLOUD_TOKEN",
  "HCLOUD_ENDPOINT",
  "TENBOX_SERVER_VOLUME_GRACE_DAYS",
  "TENBOX_SERVER_NTFY",
  "TENBOX_SERVER_GITHUB_APP_ID",
  "TENBOX_SERVER_GITHUB_APP_KEY_FILE",
  "GITHUB_API_URL",
];
const VOLUME_DEFAULTS = { graceDays: 3, ntfy: null };
const saved: Record<string, string | undefined> = Object.fromEntries(
  KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("defaults: port 4300 and ~/.tenbox-server/server.db", () => {
  for (const key of KEYS) delete process.env[key];
  expect(serverEnv()).toEqual({
    host: "localhost",
    port: 4300,
    dbFile: path.join(os.homedir(), ".tenbox-server", "server.db"),
  });
});

test("TENBOX_SERVER_PORT and TENBOX_SERVER_DB override the defaults", () => {
  process.env.TENBOX_SERVER_PORT = "4310";
  process.env.TENBOX_SERVER_DB = "/tmp/x/test.db";
  expect(serverEnv()).toEqual({ host: "localhost", port: 4310, dbFile: "/tmp/x/test.db" });
});

test("a port that is not a number from 1 to 65535 is an error", () => {
  for (const port of ["abc", "0", "70000", "43.5"]) {
    process.env.TENBOX_SERVER_PORT = port;
    expect(() => serverEnv()).toThrow(/TENBOX_SERVER_PORT/);
  }
});

test("TENBOX_SERVER_HOST sets the bound address", () => {
  process.env.TENBOX_SERVER_HOST = "0.0.0.0";
  expect(serverEnv().host).toBe("0.0.0.0");
});

test("in-cluster without HCLOUD_TOKEN stops at start", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  expect(() => nodeWatchEnv()).toThrow(/HCLOUD_TOKEN/);
  process.env.HCLOUD_TOKEN = " ";
  expect(() => nodeWatchEnv()).toThrow(/HCLOUD_TOKEN/);
});

test("without KUBERNETES_SERVICE_HOST there is no node watch", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.HCLOUD_TOKEN = "t";
  expect(nodeWatchEnv()).toBeNull();
});

test("in-cluster: the service URL and the Hetzner token, with the default endpoint", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  process.env.HCLOUD_TOKEN = "t";
  expect(nodeWatchEnv()).toEqual({
    kubernetesUrl: "https://10.43.0.1:443",
    hetzner: { url: "https://api.hetzner.cloud/v1", token: "t" },
    volumes: VOLUME_DEFAULTS,
    githubApp: null,
  });
});

test("KUBERNETES_SERVICE_PORT and HCLOUD_ENDPOINT override the defaults; an IPv6 host gets brackets", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "fd00::1";
  process.env.KUBERNETES_SERVICE_PORT = "6443";
  process.env.HCLOUD_TOKEN = "t";
  process.env.HCLOUD_ENDPOINT = "http://127.0.0.1:9000/v1";
  expect(nodeWatchEnv()).toEqual({
    kubernetesUrl: "https://[fd00::1]:6443",
    hetzner: { url: "http://127.0.0.1:9000/v1", token: "t" },
    volumes: VOLUME_DEFAULTS,
    githubApp: null,
  });
});

test("a KUBERNETES_SERVICE_PORT that is not a port is an error", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  process.env.KUBERNETES_SERVICE_PORT = "https";
  process.env.HCLOUD_TOKEN = "t";
  expect(() => nodeWatchEnv()).toThrow(/KUBERNETES_SERVICE_PORT/);
});

test("TENBOX_SERVER_VOLUME_GRACE_DAYS and TENBOX_SERVER_NTFY set the volume rules", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  process.env.HCLOUD_TOKEN = "t";
  process.env.TENBOX_SERVER_VOLUME_GRACE_DAYS = "0";
  process.env.TENBOX_SERVER_NTFY = "https://ntfy.example.com/topic";
  expect(nodeWatchEnv()?.volumes).toEqual({ graceDays: 0, ntfy: "https://ntfy.example.com/topic" });
  process.env.TENBOX_SERVER_NTFY = " ";
  expect(nodeWatchEnv()?.volumes.ntfy).toBeNull();
});

test("a grace that is not a whole number of days or an ntfy that is not a URL is an error; the URL is not shown", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  process.env.HCLOUD_TOKEN = "t";
  for (const days of ["abc", "-1", "1.5", ""]) {
    process.env.TENBOX_SERVER_VOLUME_GRACE_DAYS = days;
    expect(() => nodeWatchEnv()).toThrow(/TENBOX_SERVER_VOLUME_GRACE_DAYS/);
  }
  delete process.env.TENBOX_SERVER_VOLUME_GRACE_DAYS;
  process.env.TENBOX_SERVER_NTFY = "ntfy.example.com/secret-topic";
  expect(() => nodeWatchEnv()).toThrow(/^TENBOX_SERVER_NTFY "\(not shown\)"/);
});

function inCluster(): void {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  process.env.HCLOUD_TOKEN = "t";
}

function keyFile(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenbox-app-key-"));
  const file = path.join(dir, "key.pem");
  fs.writeFileSync(file, text);
  return file;
}

test("the GitHub App: its id, the key read from its file and the default API", () => {
  inCluster();
  process.env.TENBOX_SERVER_GITHUB_APP_ID = "123456";
  process.env.TENBOX_SERVER_GITHUB_APP_KEY_FILE = keyFile("a key\n");
  expect(nodeWatchEnv()?.githubApp).toEqual({
    url: "https://api.github.com",
    appId: "123456",
    key: "a key\n",
  });
  process.env.GITHUB_API_URL = "http://127.0.0.1:9001";
  expect(nodeWatchEnv()?.githubApp?.url).toBe("http://127.0.0.1:9001");
});

test("an App id without its key file, a missing key file or an id that is not a number is an error", () => {
  inCluster();
  process.env.TENBOX_SERVER_GITHUB_APP_ID = "123456";
  expect(() => nodeWatchEnv()).toThrow(/TENBOX_SERVER_GITHUB_APP_KEY_FILE/);
  process.env.TENBOX_SERVER_GITHUB_APP_KEY_FILE = "/no/such/key.pem";
  expect(() => nodeWatchEnv()).toThrow(/TENBOX_SERVER_GITHUB_APP_KEY_FILE/);
  process.env.TENBOX_SERVER_GITHUB_APP_KEY_FILE = keyFile("a key");
  process.env.TENBOX_SERVER_GITHUB_APP_ID = "tenbox";
  expect(() => nodeWatchEnv()).toThrow(/TENBOX_SERVER_GITHUB_APP_ID/);
  delete process.env.TENBOX_SERVER_GITHUB_APP_ID;
  expect(() => nodeWatchEnv()).toThrow(/TENBOX_SERVER_GITHUB_APP_ID/);
});

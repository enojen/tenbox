import { afterEach, expect, test } from "bun:test";
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
];
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
  });
});

test("a KUBERNETES_SERVICE_PORT that is not a port is an error", () => {
  for (const key of KEYS) delete process.env[key];
  process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
  process.env.KUBERNETES_SERVICE_PORT = "https";
  process.env.HCLOUD_TOKEN = "t";
  expect(() => nodeWatchEnv()).toThrow(/KUBERNETES_SERVICE_PORT/);
});

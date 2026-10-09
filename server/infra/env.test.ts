import { afterEach, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { serverEnv } from "./env.ts";

const KEYS = ["TENBOX_SERVER_PORT", "TENBOX_SERVER_DB"];
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
    port: 4300,
    dbFile: path.join(os.homedir(), ".tenbox-server", "server.db"),
  });
});

test("TENBOX_SERVER_PORT and TENBOX_SERVER_DB override the defaults", () => {
  process.env.TENBOX_SERVER_PORT = "4310";
  process.env.TENBOX_SERVER_DB = "/tmp/x/test.db";
  expect(serverEnv()).toEqual({ port: 4310, dbFile: "/tmp/x/test.db" });
});

test("a port that is not a number from 1 to 65535 is an error", () => {
  for (const port of ["abc", "0", "70000", "43.5"]) {
    process.env.TENBOX_SERVER_PORT = port;
    expect(() => serverEnv()).toThrow(/TENBOX_SERVER_PORT/);
  }
});

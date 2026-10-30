import { afterAll, afterEach } from "bun:test";
import { CLAUDE_SESSION_VAR } from "../infra/env.ts";
import { removeBundle } from "./bundle.ts";
import { clearFakeTools } from "./fakeTools.ts";
import { hermeticPath, removeHermeticPath } from "./hermetic.ts";

process.env.PATH = hermeticPath(process.env.PATH ?? "");
delete process.env[CLAUDE_SESSION_VAR];

afterEach(clearFakeTools);

afterAll(() => {
  removeBundle();
  removeHermeticPath();
});

import { afterAll, afterEach } from "bun:test";
import { removeBundle } from "./bundle.ts";
import { clearFakeTools } from "./fakeTools.ts";
import { hermeticPath, removeHermeticPath } from "./hermetic.ts";

process.env.PATH = hermeticPath(process.env.PATH ?? "");

afterEach(clearFakeTools);

afterAll(() => {
  removeBundle();
  removeHermeticPath();
});

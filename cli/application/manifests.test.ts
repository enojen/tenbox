import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { files } from "../infra/files.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { manifests } from "./manifests.ts";

let project: TempProject;

afterEach(async () => {
  await project.remove();
});

const yamlPath = (): string => path.join(project.mainDir, "tenbox.yaml");

test("a local layer with an id fails: the id belongs in tenbox.yaml", async () => {
  project = await makeTempProject({
    "tenbox.yaml": "project: demo\n",
    "tenbox.local.yaml": "id: k7f3qa\n",
  });
  const local = path.join(project.mainDir, "tenbox.local.yaml");
  const error = await manifests.get(project.mainDir).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: "manifest", message: `${local}: id belongs in tenbox.yaml` });
});

test("ensureId appends the id line and keeps every other byte", async () => {
  const before = "# my project\nproject: demo\nchecks:\n  unit: 'bun test'\n";
  project = await makeTempProject({ "tenbox.yaml": before });
  const id = await manifests.ensureId(project.mainDir);
  expect(id).toMatch(/^[a-z0-9]{6}$/);
  const text = await files.read(yamlPath());
  expect(text).toBe(`${before}id: ${id}\n`);
});

test("ensureId adds a newline when the file does not end with one", async () => {
  project = await makeTempProject({ "tenbox.yaml": "project: demo" });
  const id = await manifests.ensureId(project.mainDir);
  const text = await files.read(yamlPath());
  expect(text).toBe(`project: demo\nid: ${id}\n`);
});

test("ensureId keeps an existing id and writes nothing", async () => {
  const before = "project: demo\nid: k7f3qa\n";
  project = await makeTempProject({ "tenbox.yaml": before });
  const id = await manifests.ensureId(project.mainDir);
  expect(String(id)).toBe("k7f3qa");
  const text = await files.read(yamlPath());
  expect(text).toBe(before);
});

test("ensureId creates tenbox.yaml with only the id line", async () => {
  project = await makeTempProject({ "README.md": "x\n" });
  const id = await manifests.ensureId(project.mainDir);
  const text = await files.read(yamlPath());
  expect(text).toBe(`id: ${id}\n`);
});

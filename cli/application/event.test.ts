import { afterEach, expect, test } from "bun:test";
import { projectId, taskId } from "../../domain/ids.ts";
import { outboxFile, projectDir } from "../../domain/taskDirs.ts";
import { taskClosed, taskStarted } from "../../domain/tenportEvents.ts";
import { files } from "../infra/files.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { type FakeTenport, startFakeTenport, TENPORT_TOKEN } from "../test/tenport.ts";
import { events } from "./event.ts";

const HTTP_CONFLICT = 409;
const HTTP_SERVER_ERROR = 500;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const project = projectId("k7f3qa");
const started = taskStarted({ project, task: taskId("TEN-1"), title: "Login", url: "" });
const closed = taskClosed({ project, task: taskId("TEN-1") });

let temp: TempProject;
let tenport: FakeTenport;

async function setup(): Promise<void> {
  temp = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  tenport = startFakeTenport();
}

const outbox = (): string => outboxFile(projectDir(temp.tenboxHome, project));

async function outboxTypes(): Promise<unknown[]> {
  const text = await files.read(outbox());
  return (text ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).type);
}

afterEach(async () => {
  tenport.stop();
  await temp.remove();
});

test("without TENPORT_URL and TENPORT_TOKEN nothing is sent or kept", async () => {
  await setup();
  await events.send(started);
  const kept = await files.exists(outbox());
  expect(tenport.posts()).toEqual([]);
  expect(kept).toBe(false);
});

test("an event goes to POST /events with the token, a v7 id and the time", async () => {
  await setup();
  tenport.use();
  await events.send(started);
  const [post] = tenport.posts();
  const kept = await files.exists(outbox());
  expect(post?.path).toBe("/events");
  expect(post?.authorization).toBe(`Bearer ${TENPORT_TOKEN}`);
  expect(post?.events).toEqual([
    { ...started, id: expect.stringMatching(UUID_V7), at: expect.any(String) },
  ]);
  expect(kept).toBe(false);
});

test("an event Tenport does not take waits in the outbox and goes first next time", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(started);
  const waiting = await outboxTypes();
  await events.send(closed);
  const kept = await files.exists(outbox());
  expect(waiting).toEqual(["task.started"]);
  expect(tenport.events().map((event) => event.type)).toEqual([
    "task.started",
    "task.started",
    "task.closed",
  ]);
  expect(kept).toBe(false);
});

test("when the first waiting event fails, the later ones stay behind it in order", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(started);
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(closed);
  const waiting = await outboxTypes();
  expect(waiting).toEqual(["task.started", "task.closed"]);
});

test("an event Tenport cannot reach waits in the outbox", async () => {
  await setup();
  tenport.use();
  tenport.stop();
  await events.send(started);
  const waiting = await outboxTypes();
  expect(waiting).toEqual(["task.started"]);
});

test("a 409 answer means Tenport knows it already: the event is not kept", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_CONFLICT);
  await events.send(started);
  const kept = await files.exists(outbox());
  expect(kept).toBe(false);
});

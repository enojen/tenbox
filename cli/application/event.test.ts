import { afterEach, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { taskClosed, taskStarted } from "../../domain/event.ts";
import { projectId, taskId } from "../../domain/ids.ts";
import { outboxDir, projectDir } from "../../domain/taskDirs.ts";
import { files } from "../infra/files.ts";
import { makeTempProject, type TempProject } from "../test/tempProject.ts";
import { type FakeTenport, startFakeTenport, TENPORT_TOKEN } from "../test/tenport.ts";
import { events } from "./event.ts";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_SERVER_ERROR = 500;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OLD_ID = "019a0000-0000-7000-8000-000000000001";
const OLD_AT = "2026-11-17T10:00:00.000Z";

const project = projectId("k7f3qa");
const started = taskStarted({ project, task: taskId("TEN-1"), title: "Login", url: "" });
const closed = taskClosed({ project, task: taskId("TEN-1") });
const other = taskStarted({ project, task: taskId("TEN-2"), title: "Logout", url: "" });

let temp: TempProject;
let tenport: FakeTenport;

async function setup(): Promise<void> {
  temp = await makeTempProject({ "tenbox.yaml": "project: demo\n" });
  tenport = startFakeTenport();
}

const outbox = (): string => outboxDir(projectDir(temp.tenboxHome, project));

async function outboxEvents(): Promise<Record<string, unknown>[]> {
  const names = await files.list(outbox());
  const texts = await Promise.all(
    names.sort().map((name) => files.read(path.join(outbox(), name))),
  );
  return texts.map((text) => JSON.parse(text ?? "null"));
}

async function outboxTypes(): Promise<unknown[]> {
  const waiting = await outboxEvents();
  return waiting.map((event) => `${event.type} ${event.task}`);
}

async function putInOutbox(name: string, text: string): Promise<void> {
  await files.write(path.join(outbox(), name), text);
}

function stderrLines(): string[] {
  const lines: string[] = [];
  spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
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
  const waiting = await outboxTypes();
  expect(post?.path).toBe("/events");
  expect(post?.authorization).toBe(`Bearer ${TENPORT_TOKEN}`);
  expect(post?.events).toEqual([
    { ...started, id: expect.stringMatching(UUID_V7), at: expect.any(String) },
  ]);
  expect(waiting).toEqual([]);
});

test("the event is in the outbox before it is sent, so a command that dies keeps it", async () => {
  await setup();
  tenport.use();
  let inOutbox: unknown[] = [];
  tenport.beforeAnswer(async () => {
    inOutbox = await outboxTypes();
  });
  await events.send(started);
  expect(inOutbox).toEqual(["task.started TEN-1"]);
});

test("an event Tenport does not take waits in the outbox and goes first next time", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(started);
  const waiting = await outboxTypes();
  await events.send(closed);
  const left = await outboxTypes();
  expect(waiting).toEqual(["task.started TEN-1"]);
  expect(tenport.events().map((event) => event.type)).toEqual([
    "task.started",
    "task.started",
    "task.closed",
  ]);
  expect(left).toEqual([]);
});

test("when the first waiting event fails, the later ones stay behind it in order", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(started);
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(closed);
  const waiting = await outboxTypes();
  expect(waiting).toEqual(["task.started TEN-1", "task.closed TEN-1"]);
});

test("two sends at the same time both keep their event when Tenport fails", async () => {
  await setup();
  tenport.use();
  for (const _ of [1, 2, 3, 4]) tenport.answerNext(HTTP_SERVER_ERROR);
  await Promise.all([events.send(started), events.send(other)]);
  const waiting = await outboxTypes();
  expect(waiting.toSorted()).toEqual(["task.started TEN-1", "task.started TEN-2"]);
});

test("an event Tenport cannot reach waits in the outbox", async () => {
  await setup();
  tenport.use();
  tenport.stop();
  await events.send(started);
  const waiting = await outboxTypes();
  expect(waiting).toEqual(["task.started TEN-1"]);
});

test("a 409 answer means Tenport knows it already: the event is not kept", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_CONFLICT);
  await events.send(started);
  const waiting = await outboxTypes();
  expect(waiting).toEqual([]);
});

test("a 400 answer drops the event with a stderr line, and the later events still go", async () => {
  await setup();
  tenport.use();
  tenport.answerNext(HTTP_SERVER_ERROR);
  await events.send(started);
  tenport.answerNext(HTTP_BAD_REQUEST);
  const lines = stderrLines();
  await events.send(other);
  const waiting = await outboxTypes();
  expect(tenport.events().map((event) => event.task)).toEqual(["TEN-1", "TEN-1", "TEN-2"]);
  expect(waiting).toEqual([]);
  expect(lines.join("")).toContain("task event dropped: ");
});

test("an event of a type this tenbox does not know is sent as it is", async () => {
  await setup();
  tenport.use();
  const paused = { id: OLD_ID, at: OLD_AT, type: "task.paused", project, task: "TEN-9" };
  await putInOutbox(`${OLD_ID}.json`, JSON.stringify(paused));
  await events.send(started);
  const waiting = await outboxTypes();
  expect(tenport.events().map((event) => event.type)).toEqual(["task.paused", "task.started"]);
  expect(waiting).toEqual([]);
});

test("an outbox file that is not JSON is dropped with a stderr line", async () => {
  await setup();
  tenport.use();
  await putInOutbox(`${OLD_ID}.json`, "{not json");
  const lines = stderrLines();
  await events.send(started);
  const waiting = await files.list(outbox());
  expect(tenport.events().map((event) => event.type)).toEqual(["task.started"]);
  expect(waiting).toEqual([]);
  expect(lines.join("")).toContain("task event dropped: ");
});

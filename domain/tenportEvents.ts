import { z } from "zod";
import { badFileError } from "./errors/index.ts";
import type { ProjectId, TaskId } from "./ids.ts";
import { jsons } from "./utils.ts";

const TENPORT_EVENT = { taskStarted: "task.started", taskClosed: "task.closed" } as const;

const TITLE_MAX_CHARS = 200;
const LINK_PATTERN = /^https?:\/\/\S+$/;

const text = z.string().min(1);

const StampSchema = z.object({ id: text, at: z.iso.datetime() });

const TaskStartedBodySchema = z.object({
  type: z.literal(TENPORT_EVENT.taskStarted),
  project: text,
  task: text,
  title: text.optional(),
  url: text.optional(),
});

const TaskClosedBodySchema = z.object({
  type: z.literal(TENPORT_EVENT.taskClosed),
  project: text,
  task: text,
});

const TenportEventSchema = z.discriminatedUnion("type", [
  TaskStartedBodySchema.extend(StampSchema.shape),
  TaskClosedBodySchema.extend(StampSchema.shape),
]);

export type TenportEventBody =
  | z.infer<typeof TaskStartedBodySchema>
  | z.infer<typeof TaskClosedBodySchema>;

export type TenportEvent = z.infer<typeof TenportEventSchema>;

export interface StartedTask {
  project: ProjectId;
  task: TaskId;
  title: string;
  url: string;
}

export interface ClosedTask {
  project: ProjectId;
  task: TaskId;
}

export function taskStarted(started: StartedTask): TenportEventBody {
  const { project, task, title, url } = started;
  const shortTitle = Array.from(title.trim()).slice(0, TITLE_MAX_CHARS).join("");
  return {
    type: TENPORT_EVENT.taskStarted,
    project,
    task,
    ...(shortTitle === "" ? {} : { title: shortTitle }),
    ...(LINK_PATTERN.test(url) ? { url } : {}),
  };
}

export function taskClosed(closed: ClosedTask): TenportEventBody {
  const { project, task } = closed;
  return { type: TENPORT_EVENT.taskClosed, project, task };
}

export function readOutbox(content: string, file: string): TenportEvent[] {
  const { values, skipped } = jsons.checkLines(TenportEventSchema, content);
  if (skipped > 0) throw badFileError(file, [`${skipped} lines are not task events`]);
  return values;
}

export function outboxText(events: TenportEvent[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

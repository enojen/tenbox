import { createRoute, z } from "@hono/zod-openapi";
import { JobFinishedSchema } from "../../domain/events.ts";

const TaskRunsSchema = z
  .object({ ok: z.boolean(), runs: z.array(JobFinishedSchema) })
  .openapi("TaskRuns");

export const taskRunsRoute = createRoute({
  method: "get",
  path: "/tasks/{task}/runs",
  request: { params: z.object({ task: z.string().min(1) }) },
  responses: {
    200: {
      content: { "application/json": { schema: TaskRunsSchema } },
      description: "The job.finished events of the task's machine runs, oldest finished first",
    },
  },
});

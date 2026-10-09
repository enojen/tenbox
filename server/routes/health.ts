import { createRoute, z } from "@hono/zod-openapi";

const HealthSchema = z.object({ ok: z.boolean() }).openapi("Health");

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "The server is up",
    },
  },
});

import { createRoute, z } from "@hono/zod-openapi";
import { CostReportSchema, CostWindowSchema } from "../../domain/costs.ts";

const CostsSchema = CostReportSchema.extend({ ok: z.boolean() }).openapi("Costs");

export const costsRoute = createRoute({
  method: "get",
  path: "/costs",
  request: { query: CostWindowSchema },
  responses: {
    200: {
      content: { "application/json": { schema: CostsSchema } },
      description: "Paid hours and net EUR per worker of the cluster in the window",
    },
  },
});

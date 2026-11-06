import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { costs } from "../application/costs.ts";
import { events } from "../application/events.ts";
import { machineRuns } from "../application/machineRuns.ts";
import type { Db } from "../infra/db/index.ts";
import { type AuthEnv, requireAdmin, requireToken } from "./auth.ts";
import { costsRoute } from "./costs.ts";
import { eventsRoute } from "./events.ts";
import { healthRoute } from "./health.ts";
import { failBadInput, notFound, onError } from "./problems.ts";
import { taskRunsRoute } from "./runs.ts";

const OPENAPI_PATH = "/openapi.json";
const OPENAPI_VERSION = "3.1.0";

/** The HTTP API: each route has a zod schema, and `/openapi.json` is built from them. */
export function createApp(db: Db): OpenAPIHono<AuthEnv> {
  const app = new OpenAPIHono<AuthEnv>({ defaultHook: failBadInput });
  app.onError(onError);
  app.notFound(notFound);
  app.use("*", requireToken(db));
  app.openapi(healthRoute, (c) => c.json({ ok: true }));
  app.openapi(eventsRoute, (c) => {
    const saved = events.save(db, { userId: c.get("user").id, events: c.req.valid("json") });
    return c.json({ ok: true, ...saved });
  });
  app.openapi(costsRoute, (c) => {
    requireAdmin(db, c.get("user"), "GET /costs");
    return c.json({ ok: true, ...costs.get(db, c.req.valid("query")) });
  });
  app.openapi(taskRunsRoute, (c) =>
    c.json({ ok: true, runs: machineRuns.list(db, c.req.valid("param").task) }),
  );
  app.doc31(OPENAPI_PATH, {
    openapi: OPENAPI_VERSION,
    info: { title: "Tenbox server", version: "1" },
  });
  app.get("/docs", swaggerUI({ url: OPENAPI_PATH }));
  return app;
}

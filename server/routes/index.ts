import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Db } from "../infra/db/index.ts";
import { requireToken } from "./auth.ts";
import { healthRoute } from "./health.ts";
import { notFound, onError } from "./problems.ts";

const OPENAPI_PATH = "/openapi.json";
const OPENAPI_VERSION = "3.1.0";

/** The HTTP API: each route has a zod schema, and `/openapi.json` is built from them. */
export function createApp(db: Db): OpenAPIHono {
  const app = new OpenAPIHono();
  app.onError(onError);
  app.notFound(notFound);
  app.use("*", requireToken(db));
  app.openapi(healthRoute, (c) => c.json({ ok: true }));
  app.doc31(OPENAPI_PATH, {
    openapi: OPENAPI_VERSION,
    info: { title: "Tenbox server", version: "1" },
  });
  app.get("/docs", swaggerUI({ url: OPENAPI_PATH }));
  return app;
}

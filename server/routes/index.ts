import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { healthRoute } from "./health.ts";

const OPENAPI_PATH = "/openapi.json";
const OPENAPI_VERSION = "3.1.0";
const NOT_FOUND_STATUS = 404;

/** The HTTP API: each route has a zod schema, and `/openapi.json` is built from them. */
export const app = new OpenAPIHono();

app.openapi(healthRoute, (c) => c.json({ ok: true }));

app.doc31(OPENAPI_PATH, {
  openapi: OPENAPI_VERSION,
  info: { title: "Tenbox server", version: "1" },
});
app.get("/docs", swaggerUI({ url: OPENAPI_PATH }));
app.notFound((c) => c.json({ ok: false, error: "not found" }, NOT_FOUND_STATUS));

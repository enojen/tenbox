import { createRoute, z } from "@hono/zod-openapi";

export const RUN_CREDENTIALS_PATH = "/run-credentials";

const RunCredentialRequestSchema = z
  .object({ placeholder: z.string().min(1), host: z.string().min(1) })
  .openapi("RunCredentialRequest");

const RunCredentialSchema = z
  .object({ ok: z.boolean(), value: z.string() })
  .openapi("RunCredential");

export const runCredentialsRoute = createRoute({
  method: "post",
  path: RUN_CREDENTIALS_PATH,
  request: {
    body: { content: { "application/json": { schema: RunCredentialRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RunCredentialSchema } },
      description:
        "The real value of an open run's placeholder for one host; for the injector only",
    },
  },
});

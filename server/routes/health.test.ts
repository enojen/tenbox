import { expect, test } from "bun:test";
import { z } from "zod";
import { database } from "../infra/db/index.ts";
import { createApp } from "./index.ts";

const app = createApp(database.open(":memory:"));

/** The parts of the OpenAPI document the test reads. */
const OpenApiDocSchema = z.object({
  openapi: z.string(),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

test("GET /health returns 200 ok true", async () => {
  const response = await app.request("/health");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ ok: true });
});

test("any other path without a token returns 401", async () => {
  const response = await app.request("/nope");
  expect(response.status).toBe(401);
});

test("POST /health returns 404", async () => {
  const response = await app.request("/health", { method: "POST" });
  expect(response.status).toBe(404);
});

test("GET /openapi.json describes GET /health", async () => {
  const response = await app.request("/openapi.json");
  expect(response.status).toBe(200);
  const body = await response.json();
  const doc = OpenApiDocSchema.parse(body);
  expect(doc.openapi).toStartWith("3.");
  expect(Object.keys(doc.paths["/health"] ?? {})).toEqual(["get"]);
});

test("GET /docs serves Swagger UI for /openapi.json", async () => {
  const response = await app.request("/docs");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("swagger");
  expect(html).toContain("/openapi.json");
});

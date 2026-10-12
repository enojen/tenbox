import { afterAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { graphqlQuery } from "./graphql.ts";
import { type Endpoint, http } from "./http.ts";

const HTTP_SERVER_ERROR = 500;

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const route = new URL(request.url).pathname;
    if (route === "/ok") return Response.json({ answer: 42 });
    if (route === "/broken") return new Response("boom", { status: HTTP_SERVER_ERROR });
    if (route === "/echo")
      return Response.json({ answer: 1, method: request.method, hasBody: request.body !== null });
    if (route === "/html") return new Response("<html>");
    if (route === "/graphql-errors")
      return Response.json({ errors: [{ message: "a" }, { message: "b" }] });
    return Response.json({ data: { issue: { id: "1" } } });
  },
});

afterAll(() => server.stop());

function endpoint(route: string): Endpoint {
  const url = `http://localhost:${server.port}${route}`;
  return { service: "Demo", url, headers: {}, errorCode: "demo" };
}

const AnswerSchema = z.object({ answer: z.number() });
const EchoSchema = z.object({ method: z.string(), hasBody: z.boolean() });

describe("http", () => {
  test("returns the validated JSON answer", async () => {
    const answer = await http.post({ endpoint: endpoint("/ok"), body: {}, schema: AnswerSchema });
    expect(answer).toEqual({ answer: 42 });
  });
  test("a GET sends no body and returns the validated answer", async () => {
    const answer = await http.get({ endpoint: endpoint("/echo"), schema: EchoSchema });
    expect(answer).toEqual({ method: "GET", hasBody: false });
  });
  test("a PUT sends its body", async () => {
    const answer = await http.put({ endpoint: endpoint("/echo"), body: {}, schema: EchoSchema });
    expect(answer).toEqual({ method: "PUT", hasBody: true });
  });
  test("a non-2xx status names the service, the status and the body", async () => {
    const request = http.post({ endpoint: endpoint("/broken"), body: {}, schema: AnswerSchema });
    await expect(request).rejects.toMatchObject({ message: "Demo: HTTP 500: boom", code: "demo" });
  });
  test("an answer that is not JSON is the service's error", async () => {
    const request = http.post({ endpoint: endpoint("/html"), body: {}, schema: AnswerSchema });
    await expect(request).rejects.toMatchObject({ message: "Demo: the answer is not JSON" });
  });
  test("an answer of the wrong shape is rejected", async () => {
    const request = http.post({ endpoint: endpoint("/graphql"), body: {}, schema: AnswerSchema });
    await expect(request).rejects.toMatchObject({ message: "Demo: unexpected response" });
  });
});

describe("graphqlQuery", () => {
  const IssueData = z.object({ issue: z.object({ id: z.string() }) });

  test("returns the validated data", async () => {
    const request = { endpoint: endpoint("/graphql"), query: "q", variables: {}, data: IssueData };
    const data = await graphqlQuery(request);
    expect(data).toEqual({ issue: { id: "1" } });
  });
  test("GraphQL errors fail the query with every message", async () => {
    const request = {
      endpoint: endpoint("/graphql-errors"),
      query: "q",
      variables: {},
      data: IssueData,
    };
    await expect(graphqlQuery(request)).rejects.toMatchObject({ message: "Demo: a; b" });
  });
});

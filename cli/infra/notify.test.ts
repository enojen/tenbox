import { afterAll, expect, test } from "bun:test";
import { startFakeNtfy } from "../test/ntfy.ts";
import { notify } from "./notify.ts";

const ntfy = startFakeNtfy();
afterAll(() => ntfy.stop());

test("posts the topic and the line as JSON to the server root", async () => {
  await notify.send({ url: ntfy.url, line: "demo · T-1 · failed → tenbox attach T-1" });
  const message = "demo · T-1 · failed → tenbox attach T-1";
  expect(ntfy.posts()).toEqual([{ path: "/", body: { topic: "topic", message } }]);
});

test("a refused connection is a tenbox error", async () => {
  const refused = notify.send({ url: "http://localhost:1/topic", line: "x" });
  await expect(refused).rejects.toMatchObject({ code: "ntfy" });
});

test("a click link goes into the body as click", async () => {
  const before = ntfy.posts().length;
  await notify.send({ url: ntfy.url, line: "x", click: "https://claude.ai/code/session_A" });
  expect(ntfy.posts().slice(before)).toEqual([
    {
      path: "/",
      body: { topic: "topic", message: "x", click: "https://claude.ai/code/session_A" },
    },
  ]);
});

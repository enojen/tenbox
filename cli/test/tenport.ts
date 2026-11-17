import { jsons, objects } from "../../domain/utils.ts";

const HTTP_OK = 200;

interface TenportPost {
  path: string;
  authorization: string | null;
  events: Record<string, unknown>[];
}

export interface FakeTenport {
  url: string;
  posts(): TenportPost[];
  events(): Record<string, unknown>[];
  answerNext(status: number): void;
  beforeAnswer(step: () => Promise<void>): void;
  use(): void;
  stop(): void;
}

export const TENPORT_TOKEN = "tbx_test";

export function startFakeTenport(): FakeTenport {
  const posts: TenportPost[] = [];
  const answers: number[] = [];
  const steps: (() => Promise<void>)[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const text = await request.text();
      const body = jsons.parse(text);
      const events = Array.isArray(body) ? body.filter(objects.isRecord) : [];
      const step = steps.shift();
      if (step !== undefined) await step();
      const status = answers.shift() ?? HTTP_OK;
      posts.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        events,
      });
      const answer = status === HTTP_OK ? { stored: events.length, skipped: 0 } : { status };
      return Response.json(answer, { status });
    },
  });
  const url = `http://localhost:${server.port}`;
  return {
    url,
    posts: () => posts,
    events: () => posts.flatMap((post) => post.events),
    answerNext: (status) => answers.push(status),
    beforeAnswer: (step) => steps.push(step),
    use: () => {
      process.env.TENPORT_URL = url;
      process.env.TENPORT_TOKEN = TENPORT_TOKEN;
    },
    stop: () => server.stop(true),
  };
}

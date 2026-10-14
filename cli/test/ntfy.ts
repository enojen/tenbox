import { parseObject } from "../../domain/utils.ts";

/** One POST the fake got: its path and its JSON body. */
interface NtfyPost {
  path: string;
  body: Record<string, unknown> | null;
}

/** A local ntfy server that answers like ntfy and keeps every POST. */
export interface FakeNtfy {
  /** The topic URL for `notify.ntfy`. */
  url: string;
  posts(): NtfyPost[];
  /** The `message` of each POST. */
  lines(): unknown[];
  stop(): void;
}

export function startFakeNtfy(): FakeNtfy {
  const posts: NtfyPost[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const text = await request.text();
      const body = parseObject(text);
      posts.push({ path: new URL(request.url).pathname, body });
      return Response.json({ id: "x" });
    },
  });
  return {
    url: `http://localhost:${server.port}/topic`,
    posts: () => posts,
    lines: () => posts.map((post) => post.body?.message),
    stop: () => server.stop(),
  };
}

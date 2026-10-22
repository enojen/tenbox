import { spyOn } from "bun:test";

/** What `read` gave and what it wrote to stderr meanwhile. */
export interface Captured<T> {
  value: T;
  stderr: string;
}

export async function captureStderr<T>(read: () => Promise<T>): Promise<Captured<T>> {
  let stderr = "";
  const spy = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const value = await read();
    return { value, stderr };
  } finally {
    spy.mockRestore();
  }
}

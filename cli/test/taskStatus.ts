import { readTaskFile } from "../../domain/task.ts";
import { files } from "../infra/files.ts";

/** The `status` in a `task.json` file; null when it is missing. */
export async function readStatus(taskJson: string): Promise<string | null> {
  const text = await files.read(taskJson);
  return text === null ? null : (readTaskFile(text)?.status ?? null);
}

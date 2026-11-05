import { TenboxError } from "./index.ts";

export function backupExistsError(file: string): TenboxError {
  return new TenboxError(
    `backup file ${file} already exists; it is not overwritten`,
    "backup-exists",
  );
}

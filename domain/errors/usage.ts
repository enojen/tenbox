import { TenboxError } from "./index.ts";

export class UsageError extends TenboxError {
  constructor(message: string) {
    super(message, "usage");
    this.name = "UsageError";
  }
}

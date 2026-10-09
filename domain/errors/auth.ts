import { TenboxError } from "./index.ts";

export class UnauthorizedError extends TenboxError {
  constructor() {
    super("a valid Authorization: Bearer <token> header is needed", "unauthorized");
    this.name = "UnauthorizedError";
  }
}

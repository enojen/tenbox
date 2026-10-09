import { TenboxError } from "./index.ts";

export class UserExistsError extends TenboxError {
  constructor(github: string) {
    super(`user "${github}" already exists`, "user-exists");
    this.name = "UserExistsError";
  }
}

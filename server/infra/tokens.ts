import { randomBytes } from "node:crypto";
import { sha256Hex } from "../../domain/utils.ts";

const TOKEN_PREFIX = "tbx_";
const TOKEN_BYTES = 32;

function make(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("hex");
}

function hash(token: string): string {
  return sha256Hex(token);
}

export const tokens = { make, hash };

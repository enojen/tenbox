import { TenboxError } from "./index.ts";

/* Errors of the cards: a card that is not there or not the kind asked for. */

export function noCardError(id: number): TenboxError {
  return new TenboxError(`no card ${id} in cards/`, "no-card");
}

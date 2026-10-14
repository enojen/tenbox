type UserId = string & { readonly brand: "UserId" };

export const SIGNALS = ["SIGINT", "SIGTERM"] as const;
const LEVELS = { low: 1, high: 2 } as const;
export const levels = LEVELS;
export const id: UserId | null = null;
export function isUserId(value: unknown): value is UserId {
  return typeof value === "string";
}

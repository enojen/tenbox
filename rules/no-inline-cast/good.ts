type UserId = string & { readonly brand: "UserId" };

export const SIGNALS = ["SIGINT", "SIGTERM"] as const;
export const id: UserId | null = null;
export function isUserId(value: unknown): value is UserId {
  return typeof value === "string";
}

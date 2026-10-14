// Every line marked "lint:" must be reported by the rule.
type UserId = string & { readonly brand: "UserId" };
declare const raw: unknown;

export const id = raw as UserId; // lint: inline cast
export const name = (raw as { name: string }).name; // lint: inline cast
export const twice = raw as unknown as number; // lint: inline cast
export function check() {
  return { ok: true as const }; // lint: as const inside an expression
}
export const outcome = { kind: "none" as const }; // lint: as const on a nested literal

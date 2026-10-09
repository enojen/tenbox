// Every line marked "lint:" must be reported by the rule.
type UserId = string & { readonly brand: "UserId" };
declare const raw: unknown;

export const id = raw as UserId; // lint: inline cast
export const name = (raw as { name: string }).name; // lint: inline cast
export const twice = raw as unknown as number; // lint: inline cast

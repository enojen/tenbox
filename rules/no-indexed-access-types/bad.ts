// Every line marked "lint:" must be reported by the rule.
interface Result {
  status: string;
  items: { id: string }[];
}

export type Status = Result["status"]; // lint: a property of an interface
export type Item = Result["items"][number]; // lint: an element of a property
export function first(result: Result): Result["items"][number] | undefined { // lint: return type
  return result.items[0];
}

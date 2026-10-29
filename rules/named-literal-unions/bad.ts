// Every line marked "lint:" must be reported by the rule.
export interface Run {
  status: "in_progress" | "completed"; // lint: union in a property
  conclusion: "success" | "failure" | null; // lint: union with null in a property
}

export function toState(done: boolean): "deleted" | "missing" { // lint: union as a return type
  if (done) return "deleted";
  return "missing";
}

export function label(kind: "a" | "b"): string { // lint: union as a parameter
  return kind;
}

export type Counts = Record<"todo" | "done", number>; // lint: union as a type argument
export type Wrapped = { state: "open" | "closed" }; // lint: union nested in an alias

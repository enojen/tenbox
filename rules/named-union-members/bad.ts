// Every line marked "lint:" must be reported by the rule.
interface Ok {
  ok: true;
}
interface Logged {
  log: string;
}

export type Inline = Ok | { ok: false; reason: string }; // lint: inline object member
export type Joined = Ok | (Ok & Logged); // lint: intersection member
export type Leading =
  | { kind: "a" } // lint: inline object member on its own line
  | Ok;

// Every line marked "lint:" must be reported by the rule.
declare const pr: { state: string };
declare const result: { status: string } | null;
declare const tracker: { kind: string };

export const created = pr.state === "created"; // lint: state compared with a string
export const open = result?.status !== "needs-you"; // lint: status compared with a string
export const none = "none" === tracker.kind; // lint: kind compared with a string
export const linked = pr.state !== 'linked'; // lint: single quotes

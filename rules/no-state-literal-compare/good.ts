const PR_STATE = { created: "created", updated: "updated" } as const;
declare const pr: { state: string; title: string };
declare const value: unknown;

export const created = pr.state === PR_STATE.created;
export const titled = pr.title === "TEN-1";
export const isText = typeof value === "string";
export const empty = pr.state === "".trim();

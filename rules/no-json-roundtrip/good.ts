declare const value: { a: number };
declare const text: string;

export const copy = structuredClone(value);
export const parsed = JSON.parse(text);
export const printed = JSON.stringify(value);

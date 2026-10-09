declare function parseJson(text: string): unknown;

export function samples(text: string): string {
  const value = parseJson(text);
  return JSON.stringify(value);
}

declare const jsons: { parse(text: string): unknown };

export function samples(text: string): string {
  const value = jsons.parse(text);
  return JSON.stringify(value);
}

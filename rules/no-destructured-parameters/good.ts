interface Input {
  a: string;
  b: number;
}

export function whole(input: Input): string {
  const { a, b } = input;
  return `${a}${b}`;
}
export const arrow = (input: Input): number => input.b;
export const [first, second] = [1, 2];
export const { a: renamed } = { a: "x" };

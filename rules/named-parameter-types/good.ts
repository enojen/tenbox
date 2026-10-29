interface Shape {
  a: string;
  b: number;
}
type Name = string;
type WithoutA = Omit<Shape, "a">;

export function named(p: Name, q: WithoutA, r: Shape): Pick<Shape, "a"> {
  console.log(q, r);
  return { a: p };
}
export const arrow = (p: Shape): void => {
  console.log(p);
};

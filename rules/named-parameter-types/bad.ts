// Every line marked "lint:" must be reported by the rule.
interface Shape {
  a: string;
  b: number;
}

export function picked(p: Pick<Shape, "a">): Pick<Shape, "a"> { // lint: Pick in a parameter
  return p;
}
export function omitted(p: Omit<Shape, "a">): void { // lint: Omit in a parameter
  console.log(p);
}
export function indexed(p: Shape["a"]): void { // lint: indexed type in a parameter
  console.log(p);
}
export function literal(p: { a: string }["a"]): void { // lint: indexed type in a parameter
  console.log(p);
}
export const arrow = (p: Omit<Shape, "b">): void => { // lint: Omit in a parameter
  console.log(p);
};

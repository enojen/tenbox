// Every line marked "lint:" must be reported by the rule.
declare function badFileError(file: string, issues: string[]): Error;
declare function badInputError(what: string, issues: string[]): Error;

export function readPlan(text: string): string {
  if (text === "") throw badInputError("the plan", []); // lint: read* with badInputError
  return text;
}

export function parseBuild(text: string): string {
  if (text === "") throw badFileError("build.json", []); // lint: parse* with badFileError
  return text;
}

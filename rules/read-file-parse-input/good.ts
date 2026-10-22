declare function badFileError(file: string, issues: string[]): Error;
declare function badInputError(what: string, issues: string[]): Error;

export function readPlan(text: string, file: string): string {
  if (text === "") throw badFileError(file, []);
  return text;
}

export function parseBuild(text: string): string {
  if (text === "") throw badInputError("the build result", []);
  return text;
}

export function checkPlanMd(text: string): void {
  if (text === "") throw badFileError("plan.md", []);
}

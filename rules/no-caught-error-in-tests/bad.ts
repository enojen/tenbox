// Every line marked "lint:" must be reported by the rule.
declare function run(): void;
declare function runLater(): Promise<void>;

export function returned(): unknown {
  try {
    run();
  } catch (error) {
    return error; // lint: catch returns the error
  }
  return null;
}

export function assigned(): unknown {
  let thrown: unknown = null;
  try {
    run();
  } catch (error) {
    thrown = error; // lint: catch assigns the error
  }
  return thrown;
}

export const viaPromise = runLater().catch((e: unknown) => e); // lint: catch returns the error
export const viaPlain = runLater().catch((e) => e); // lint: catch returns the error

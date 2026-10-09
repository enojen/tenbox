declare function run(): void;
declare function runLater(): Promise<void>;

export function isOk(): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

export function marks(): string {
  let state = "none";
  try {
    run();
  } catch (error) {
    state = "failed";
    console.error(error);
  }
  return state;
}

export const viaPromise = runLater().catch(() => false);

/** A running watch; `stop` waits for the tick in progress. */
export interface Watching {
  stop: () => Promise<void>;
}

interface Every {
  intervalMs: number;
  tick: () => Promise<unknown>;
}

function every(input: Every): Watching {
  let running: Promise<unknown> | null = null;
  const run = () => {
    if (running !== null) return;
    running = input.tick().finally(() => {
      running = null;
    });
  };
  run();
  const timer = setInterval(run, input.intervalMs);
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}

export const watchers = { every };

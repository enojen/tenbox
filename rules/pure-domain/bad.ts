// Every line marked "lint:" must be reported by the rule.
export function samples(): unknown[] {
  return [
    Date.now(), // lint: clock
    performance.now(), // lint: clock
    new Date(), // lint: clock
    Math.random(), // lint: randomness
    crypto.randomUUID(), // lint: randomness
    process.env.HOME, // lint: process
    Bun.file("plan.json"), // lint: Bun I/O
    fetch("https://example.com"), // lint: network
  ];
}

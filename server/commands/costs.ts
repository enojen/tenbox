import { parseArgs } from "node:util";
import { type CostWindow, CostWindowSchema } from "../../domain/costs.ts";
import { badInputError, issueLines } from "../../domain/errors/index.ts";
import { usageError } from "../../domain/errors/usage.ts";

/** The window of `tenbox-server costs`: both flags are required, and the window is as valid as on `GET /costs`. */
export function readCostsArgs(argv: string[]): CostWindow {
  const { values } = parseArgs({
    args: argv,
    options: { from: { type: "string" }, to: { type: "string" } },
    strict: true,
  });
  if (!values.from) throw usageError("--from <iso> is required");
  if (!values.to) throw usageError("--to <iso> is required");
  const parsed = CostWindowSchema.safeParse({ from: values.from, to: values.to });
  if (!parsed.success) throw badInputError("the window", issueLines(parsed.error));
  return parsed.data;
}

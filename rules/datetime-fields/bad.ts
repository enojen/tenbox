// Every line marked "lint:" must be reported by the rule.
import { z } from "zod";

export const Approval = z.object({
  at: z.string(), // lint: at
  createdAt: z.string().nullish(), // lint: a name that ends in At
  mergedAt: z.string().min(1).optional(), // lint: any chain after z.string()
  deadline: z.string(), // lint: deadline
});

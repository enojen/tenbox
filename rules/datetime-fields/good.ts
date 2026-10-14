import { z } from "zod";

export const Approval = z.object({
  at: z.iso.datetime(),
  createdAt: z.iso.datetime().nullish(),
  deadline: z.iso.datetime(),
  name: z.string(),
  format: z.string(),
  attempts: z.number(),
});

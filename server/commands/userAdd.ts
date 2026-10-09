import { parseArgs } from "node:util";
import { usageError } from "../../domain/errors/usage.ts";
import {
  findMembershipType,
  MEMBERSHIP_TYPES,
  type MembershipType,
} from "../../domain/membership.ts";
import type { NewUser } from "../application/users.ts";

const DEFAULT_TYPE: MembershipType = "member";

export function readUserAddArgs(argv: string[]): NewUser {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: "string" },
      github: { type: "string" },
      email: { type: "string" },
      org: { type: "string" },
      type: { type: "string" },
    },
    strict: true,
  });
  const { name, github, org, email } = values;
  if (!name || !github || !org) {
    throw usageError("user add needs --name, --github and --org");
  }
  return { name, github, org, email, type: membershipType(values.type) };
}

function membershipType(raw: string | undefined): MembershipType {
  if (raw === undefined) return DEFAULT_TYPE;
  const type = findMembershipType(raw);
  if (type !== null) return type;
  throw usageError(`--type "${raw}": ${MEMBERSHIP_TYPES.join(" or ")}`);
}

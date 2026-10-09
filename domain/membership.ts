/** What a user is in one organization; the type belongs to the membership, not to the user. */
export const MEMBERSHIP_TYPES: readonly ["admin", "member"] = ["admin", "member"];

export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

export function findMembershipType(raw: string): MembershipType | null {
  return MEMBERSHIP_TYPES.find((type) => type === raw) ?? null;
}

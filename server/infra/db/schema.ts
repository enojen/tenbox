import { sql } from "drizzle-orm";
import { check, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { MEMBERSHIP_TYPES } from "../../../domain/memberships.ts";

const MEMBERSHIP_TYPE_LIST = MEMBERSHIP_TYPES.map((type) => `'${type}'`).join(", ");

/* The server's tables. `bunx drizzle-kit generate` turns a change here into a migration. */

export const organizations = sqliteTable("organizations", {
  id: text().primaryKey(),
  name: text().notNull().unique(),
});

export const users = sqliteTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text(),
  github: text().notNull().unique(),
  tokenHash: text("token_hash").notNull().unique(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text({ enum: MEMBERSHIP_TYPES }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    check("membership_type", sql`${table.type} in (${sql.raw(MEMBERSHIP_TYPE_LIST)})`),
  ],
);

export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text().notNull(),
  repo: text().notNull(),
});

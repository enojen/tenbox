import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/infra/db/schema.ts",
  out: "./server/infra/db/migrations",
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/electron/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: "./kova.sqlite",
  },
});

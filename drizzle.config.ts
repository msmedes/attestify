import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/features/attestations/history.schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: "./.data/attestify.sqlite",
	},
});

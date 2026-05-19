import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"#": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.eval.ts"],
		testTimeout: 60_000,
		env: {
			VITEST_EVALS_REPLAY_MODE: "auto",
			VITEST_EVALS_REPLAY_DIR: ".vitest-evals/recordings",
		},
	},
});

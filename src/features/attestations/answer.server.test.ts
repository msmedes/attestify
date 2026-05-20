import { afterEach, describe, expect, it, vi } from "vitest";

describe("answerCorpus fallback", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("keeps agentic retrieval-only fallback when OpenAI is disabled", async () => {
		vi.stubEnv("ATTESTIFY_OPENAI_DISABLED", "true");
		vi.resetModules();
		const { answerCorpus } = await import("./answer.server");

		const response = await answerCorpus(
			"What is the mousetrap in Hamlet?",
			"agentic",
		);

		expect(response.queryMode).toBe("agentic");
		expect(response.retrievalChunks.length).toBeGreaterThan(0);
		expect(response.aiAnswer).toMatchObject({
			status: "unavailable",
			message: "OpenAI is disabled by ATTESTIFY_OPENAI_DISABLED.",
		});
		expect(response.aiTrace?.steps.map((step) => step.stage)).not.toContain(
			"evidence-loop",
		);
	});
});

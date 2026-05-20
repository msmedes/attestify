import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExtractionCitationChunks } from "./answer.server";
import type { SearchResponse } from "./types";

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

describe("buildExtractionCitationChunks", () => {
	it("keeps inspected spans eligible after a later search replaces retrieval chunks", () => {
		const chunks = buildExtractionCitationChunks({
			search: {
				...fakeSearchResponse(),
				retrievalChunks: [
					{
						spanId: "alice-00002",
						sourceId: "alice-in-wonderland",
						title: "Alice's Adventures in Wonderland",
						kind: "novel",
						section: "Chapter 1",
						locator: "paragraph 2",
						text: "The Rabbit took a watch out of its waistcoat-pocket.",
						score: 0.9,
					},
				],
			},
			spanIds: ["hamlet-00001"],
		});

		expect(chunks).toEqual([
			expect.objectContaining({
				spanId: "hamlet-00001",
				sourceId: "hamlet",
				score: 1,
			}),
		]);
	});
});

function fakeSearchResponse(): SearchResponse {
	return {
		query: "fake",
		queryMode: "agentic",
		retrievalQueries: ["fake"],
		answerLines: [],
		citations: [],
		retrievalChunks: [],
		corpusStats: {
			documents: 1,
			spans: 1,
			attestations: 0,
		},
	};
}

import { describe, expect, it } from "vitest";
import { searchResponseSchema } from "./response-schemas";
import type { SearchResponse } from "./types";

describe("history response compatibility", () => {
	it("accepts upgraded citations with structured identity and compact labels", () => {
		const response = {
			query: "What is the mousetrap in Hamlet?",
			retrievalQueries: ["What is the mousetrap in Hamlet?"],
			answerLines: ["Hamlet contains passage The Mousetrap [1]"],
			citations: [
				{
					attestation: {
						id: "att:hamlet-00001:passage",
						type: "passage",
						subject: "Hamlet",
						predicate: "contains passage",
						value: "The Mousetrap",
						context: "Act 3",
						anchorText: "The Mousetrap",
					},
					source: {
						sourceId: "hamlet",
						title: "Hamlet",
						kind: "play",
						attribution: "Fixture",
						updatedAt: "2026-05-19",
					},
					span: {
						spanId: "hamlet-00001",
						section: "Act 3",
						locator: "paragraph 1",
						text: "The Mousetrap",
					},
					citationHandle: "att:hamlet-00001:passage#hamlet-00001",
					citationLabel: "[1]",
					citationIdentity: {
						status: "legacy",
						legacyHandle: "att:hamlet-00001:passage#hamlet-00001",
						reason: "Legacy fixture",
						span: {
							legacySpanId: "hamlet-00001",
							locator: "paragraph 1",
						},
						attestation: {
							legacyAttestationId: "att:hamlet-00001:passage",
						},
					},
					support: {
						verifiedAgainstSource: true,
						method: "anchor substring check over source span",
					},
					score: 1,
				},
			],
			retrievalChunks: [],
			corpusStats: {
				documents: 1,
				spans: 1,
				attestations: 1,
			},
		} satisfies SearchResponse;

		expect(searchResponseSchema.parse(response).citations[0]).toMatchObject({
			citationLabel: "[1]",
			citationIdentity: {
				status: "legacy",
			},
		});
	});
});

import { describe, expect, it } from "vitest";
import { upgradePersistedSearchResponse } from "./history.server";
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
					historyEvidence: {
						status: "persisted",
						sourceTitle: "Hamlet",
						section: "Act 3",
						locator: "paragraph 1",
						quote: "The Mousetrap",
						sourceText: "The Mousetrap",
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
			historyEvidence: {
				status: "persisted",
				quote: "The Mousetrap",
			},
		});
	});

	it("upgrades old persisted citations with evidence from the stored response", () => {
		const upgraded = upgradePersistedSearchResponse({
			query: "What is the mousetrap in Hamlet?",
			retrievalQueries: ["What is the mousetrap in Hamlet?"],
			answerLines: [],
			citations: [legacyCitation()],
			retrievalChunks: [],
			corpusStats: {
				documents: 1,
				spans: 1,
				attestations: 1,
			},
		});

		expect(upgraded.citations[0]).toMatchObject({
			citationLabel: "[1]",
			citationIdentity: {
				status: "legacy",
				reason:
					"Persisted history citation predates structured citation identity.",
			},
			historyEvidence: {
				status: "persisted",
				sourceTitle: "Hamlet",
				quote: "The Mousetrap",
				sourceText: "The Mousetrap appears in the saved response.",
			},
		});
		expect(upgraded.citations[0]?.historyEvidence).not.toMatchObject({
			sourceSnapshotId: expect.any(String),
		});
		expect(searchResponseSchema.parse(upgraded).citations[0]).toMatchObject({
			historyEvidence: {
				status: "persisted",
			},
		});
	});

	it("marks old persisted citations unresolved when saved evidence is missing", () => {
		const citation = legacyCitation();
		const upgraded = upgradePersistedSearchResponse({
			query: "What is the mousetrap in Hamlet?",
			retrievalQueries: ["What is the mousetrap in Hamlet?"],
			answerLines: [],
			citations: [
				{
					...citation,
					attestation: {
						...citation.attestation,
						anchorText: "",
					},
					span: {
						...citation.span,
						text: "",
					},
				},
			],
			retrievalChunks: [],
			corpusStats: {
				documents: 1,
				spans: 1,
				attestations: 1,
			},
		});

		expect(upgraded.citations[0]?.historyEvidence).toMatchObject({
			status: "unresolved",
			reason:
				"Persisted history citation is missing source text or quote evidence.",
		});
	});
});

function legacyCitation(): SearchResponse["citations"][number] {
	return {
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
			text: "The Mousetrap appears in the saved response.",
		},
		citationHandle: "att:hamlet-00001:passage#hamlet-00001",
		citationLabel: "",
		support: {
			verifiedAgainstSource: true,
			method: "anchor substring check over source span",
		},
		score: 1,
	} as SearchResponse["citations"][number];
}

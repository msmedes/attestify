import { describe, expect, it } from "vitest";
import { buildGutenbergSourceDocument } from "./gutenberg-adapter";

describe("Gutenberg ingestion adapter", () => {
	it("projects ingestion records into the generated corpus compatibility shape", () => {
		const source = buildGutenbergSourceDocument({
			gutenbergId: 1524,
			sourceId: "hamlet",
			title: "Hamlet",
			kind: "play",
			body: [
				"CHAPTER I",
				"",
				"FRANCISCO. Nay, answer me. Stand and unfold yourself.",
				"",
				"BARNARDO. This paragraph is long enough to become a generated span candidate with citation evidence.",
			].join("\n"),
			sourceUrl: "https://www.gutenberg.org/ebooks/1524.txt.utf-8",
			updatedAt: "2026-05-19",
			maxSpans: 10,
		});

		expect(source.sourceId).toBe("hamlet");
		expect(source.ingestion).toMatchObject({
			connectorId: "project-gutenberg",
			externalSourceId: "1524",
			snapshotVersion: "gutenberg-1524-utf8",
			extractorVersion: "1.0.0",
			verifiedAt: "2026-05-19T00:00:00.000Z",
		});
		expect(source.ingestion?.snapshotId).toMatch(/^snapshot:/);
		expect(source.ingestion?.extractionRunId).toMatch(/^extraction:/);
		expect(source.ingestion?.contentHash).toHaveLength(64);
		expect(source.spans[0]).toMatchObject({
			spanId: "hamlet-00001",
			sourceId: "hamlet",
			section: "CHAPTER I",
			locator: "paragraph 1",
		});
		expect(source.spans[0]?.ingestion?.spanId).toMatch(/^span:/);
		expect(source.spans[0]?.attestations[0]).toMatchObject({
			id: "att:hamlet-00001:passage",
			type: "passage",
			subject: "Hamlet",
			predicate: "contains passage",
		});
		expect(source.spans[0]?.attestations[0]?.ingestion).toMatchObject({
			status: "verified",
			method: "anchor-substring",
		});
	});

	it("keeps generated attestations verified against adapter-produced spans", () => {
		const source = buildGutenbergSourceDocument({
			gutenbergId: 11,
			sourceId: "alice-in-wonderland",
			title: "Alice's Adventures in Wonderland",
			kind: "novel",
			body: [
				"CHAPTER I",
				"",
				"Alice was beginning to get very tired of sitting by her sister on the bank.",
			].join("\n"),
			sourceUrl: "https://www.gutenberg.org/ebooks/11.txt.utf-8",
			updatedAt: "2026-05-19",
			maxSpans: 10,
		});
		const span = source.spans[0];
		const attestation = span?.attestations[0];

		expect(span).toBeDefined();
		expect(attestation).toBeDefined();
		expect(span?.text).toContain(attestation?.anchorText);
		expect(attestation?.ingestion?.status).toBe("verified");
	});
});

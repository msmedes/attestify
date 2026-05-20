import { describe, expect, it } from "vitest";
import { corpus, getCorpusStats, listSpans } from "./corpus";
import {
	type AttestationExtractor,
	type AttestationVerifier,
	InMemoryExtractionCache,
} from "./ingestion";
import { retrievalEvalCases } from "./retrieval-evals";
import { searchCorpus, searchCorpusWithQueries } from "./search.server";

describe("generated Gutenberg corpus", () => {
	it("loads a heterogeneous real-source corpus", () => {
		const stats = getCorpusStats();

		expect(stats.documents).toBe(6);
		expect(stats.spans).toBeGreaterThan(3000);
		expect(stats.attestations).toBeGreaterThan(6000);
		expect(corpus.some((source) => source.sourceId === "hamlet")).toBe(true);
		expect(
			corpus.some((source) => source.sourceId === "crime-and-punishment"),
		).toBe(true);
		expect(corpus.some((source) => source.kind === "novel")).toBe(true);
		expect(corpus.some((source) => source.kind === "play")).toBe(true);
	});

	it("keeps every generated attestation anchored in its source span", () => {
		expect(
			listSpans().every((span) =>
				span.attestations.every((attestation) =>
					span.text.includes(attestation.anchorText),
				),
			),
		).toBe(true);
	});
});

describe("searchCorpus", () => {
	it("returns source-verified citations for Shakespeare", async () => {
		const result = await searchCorpus("What is the mousetrap in Hamlet?");

		expect(result.retrievalChunks.length).toBeGreaterThan(0);
		expect(result.citations.length).toBeGreaterThan(0);
		expect(
			result.citations.every((unit) => unit.support.verifiedAgainstSource),
		).toBe(true);
		expect(
			result.citations.some((unit) => unit.source.sourceId === "hamlet"),
		).toBe(true);
		expect(result.citations[0]?.citationHandle).toContain("#");
		expect(result.citations[0]?.citationLabel).toBe("[1]");
		expect(result.citations[0]?.citationIdentity).toMatchObject({
			status: "resolvable",
			connectorId: "project-gutenberg",
			externalSourceId: "1524",
			sourceSnapshot: {
				version: "gutenberg-1524-utf8",
			},
		});
	});

	it("returns source-verified citations for a non-play source", async () => {
		const result = await searchCorpus("What does Raskolnikov bring to Alyona?");

		expect(result.retrievalChunks.length).toBeGreaterThan(0);
		expect(result.citations.length).toBeGreaterThan(0);
		expect(
			result.citations.every((unit) => unit.support.verifiedAgainstSource),
		).toBe(true);
		expect(
			result.citations.some(
				(unit) => unit.source.sourceId === "crime-and-punishment",
			),
		).toBe(true);
	});

	it("can use expanded retrieval queries before selecting citations", async () => {
		const result = await searchCorpusWithQueries({
			query: "What does Alice see at the rabbit-hole?",
			retrievalQueries: [
				"Alice rabbit-hole white rabbit watch waistcoat-pocket",
				"Rabbit took a watch out of its waistcoat-pocket",
			],
		});

		expect(result.retrievalQueries.length).toBeGreaterThan(1);
		expect(result.retrievalChunks[0]?.sourceId).toBe("alice-in-wonderland");
		expect(
			result.citations.some((unit) =>
				/watch|waistcoat-pocket|rabbit-hole/i.test(unit.attestation.anchorText),
			),
		).toBe(true);
	});

	it("reruns citation selection after bounded lazy expansion promotes attestations", async () => {
		const result = await searchCorpusWithQueries({
			query:
				"What does the lazy expansion marker say about the mousetrap in Hamlet?",
			retrievalQueries: ["mousetrap Hamlet"],
			chunkLimit: 1,
			citationLimit: 20,
			citationScoreFloor: 0,
			lazyExpansion: {
				cache: new InMemoryExtractionCache(),
				extractor: createLazyTestExtractor(),
				verifier: createAnchorVerifier(),
				maxSpans: 1,
				startedAt: "2026-05-19T00:00:00.000Z",
				verifiedAt: "2026-05-19T00:00:01.000Z",
			},
		});

		const lazyTrace = result.aiTrace?.steps.find(
			(step) => step.stage === "lazy-expansion",
		);

		expect(lazyTrace).toMatchObject({
			stage: "lazy-expansion",
			status: "ready",
			output: {
				attempts: [
					expect.objectContaining({
						rawCandidates: 1,
						verifiedCandidates: 1,
						promotions: 1,
						rejections: 0,
						verificationResults: [
							expect.objectContaining({ status: "verified" }),
						],
					}),
				],
			},
		});
		expect(
			result.citations.some(
				(citation) => citation.attestation.subject === "Lazy expansion marker",
			),
		).toBe(true);
	});

	it("reuses cached lazy extraction results on repeated queries over the same source area", async () => {
		const cache = new InMemoryExtractionCache();
		let extractionCalls = 0;
		const extractor = createLazyTestExtractor(() => {
			extractionCalls += 1;
		});
		const options = {
			query:
				"What does the lazy expansion marker say about the mousetrap in Hamlet?",
			retrievalQueries: ["mousetrap Hamlet"],
			chunkLimit: 1,
			citationLimit: 20,
			citationScoreFloor: 0,
			lazyExpansion: {
				cache,
				extractor,
				verifier: createAnchorVerifier(),
				maxSpans: 1,
				startedAt: "2026-05-19T00:00:00.000Z",
				verifiedAt: "2026-05-19T00:00:01.000Z",
			},
		};

		await searchCorpusWithQueries(options);
		const second = await searchCorpusWithQueries(options);
		const lazyTrace = second.aiTrace?.steps.find(
			(step) => step.stage === "lazy-expansion",
		);

		expect(extractionCalls).toBe(1);
		expect(lazyTrace).toMatchObject({
			output: {
				attempts: [expect.objectContaining({ cacheHit: true })],
			},
		});
	});

	it("bounds query-triggered lazy expansion and records skipped spans", async () => {
		let extractionCalls = 0;
		const result = await searchCorpusWithQueries({
			query: "What does Hamlet say?",
			retrievalQueries: ["Hamlet says"],
			chunkLimit: 3,
			citationLimit: 20,
			citationScoreFloor: 0,
			lazyExpansion: {
				cache: new InMemoryExtractionCache(),
				extractor: createLazyTestExtractor(() => {
					extractionCalls += 1;
				}),
				verifier: createAnchorVerifier(),
				maxSpans: 1,
				startedAt: "2026-05-19T00:00:00.000Z",
				verifiedAt: "2026-05-19T00:00:01.000Z",
			},
		});
		const lazyTrace = result.aiTrace?.steps.find(
			(step) => step.stage === "lazy-expansion",
		);

		expect(extractionCalls).toBe(1);
		expect(lazyTrace).toMatchObject({
			input: { maxSpans: 1 },
			output: {
				skipped: [
					expect.objectContaining({ reason: "max-spans" }),
					expect.objectContaining({ reason: "max-spans" }),
				],
			},
		});
	});

	it("does not turn rejected lazy candidates into citations", async () => {
		const result = await searchCorpusWithQueries({
			query:
				"What does the lazy expansion marker say about the mousetrap in Hamlet?",
			retrievalQueries: ["mousetrap Hamlet"],
			chunkLimit: 1,
			citationLimit: 20,
			citationScoreFloor: 0,
			lazyExpansion: {
				cache: new InMemoryExtractionCache(),
				extractor: createLazyTestExtractor(),
				verifier: {
					verify: () => ({
						status: "rejected",
						reason: "fake verifier rejection",
					}),
				},
				maxSpans: 1,
				startedAt: "2026-05-19T00:00:00.000Z",
				verifiedAt: "2026-05-19T00:00:01.000Z",
			},
		});
		const lazyTrace = result.aiTrace?.steps.find(
			(step) => step.stage === "lazy-expansion",
		);

		expect(lazyTrace).toMatchObject({
			output: {
				attempts: [
					expect.objectContaining({
						promotions: 0,
						rejections: 1,
						verificationResults: [
							expect.objectContaining({
								status: "rejected",
								reason: "fake verifier rejection",
							}),
						],
					}),
				],
				promotedAttestationIds: [],
			},
		});
		expect(
			result.citations.some(
				(citation) => citation.attestation.subject === "Lazy expansion marker",
			),
		).toBe(false);
	});

	it.each(retrievalEvalCases)("passes retrieval eval: $id", async ({
		expectedAnchorPattern,
		expectedSourceId,
		query,
	}) => {
		const result = await searchCorpus(query);

		expect(
			result.retrievalChunks.some(
				(chunk) => chunk.sourceId === expectedSourceId,
			),
		).toBe(true);
		expect(
			result.citations.some(
				(citation) =>
					citation.source.sourceId === expectedSourceId &&
					expectedAnchorPattern.test(citation.attestation.anchorText),
			),
		).toBe(true);
	});
});

function createLazyTestExtractor(onExtract?: () => void): AttestationExtractor {
	return {
		extractorId: "lazy-test-extractor",
		extractorVersion: "1.0.0",
		extract({ span }) {
			onExtract?.();

			return [
				{
					type: "passage",
					subject: "Lazy expansion marker",
					predicate: "is supported by",
					value: span.text,
					context: "lazy expansion test",
					anchorText: span.text.slice(0, 80),
				},
			];
		},
	};
}

function createAnchorVerifier(): AttestationVerifier {
	return {
		verify({ candidate, span }) {
			return span.text.includes(candidate.anchorText)
				? { status: "verified", method: "anchor-substring" }
				: { status: "rejected", reason: "anchor missing from source span" };
		},
	};
}

import { describe, expect, it } from "vitest";
import { corpus, getCorpusStats, listSpans } from "./corpus";
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
});

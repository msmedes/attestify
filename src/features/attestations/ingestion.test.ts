import { describe, expect, it } from "vitest";
import { corpus } from "./corpus";
import {
	createAttestationCandidate,
	createExtractionRun,
	createSourceSnapshot,
	createSourceSpanCandidate,
	IngestionContractError,
	verifyAttestationCandidate,
} from "./ingestion";

describe("ingestion contract", () => {
	it("normalizes connector identity separately from external source identity", () => {
		const snapshot = createSourceSnapshot({
			connectorId: " fixture-gutenberg ",
			externalSourceId: " 1524 ",
			kind: "notion-page",
			title: " Hamlet ",
			content: " To be, or not to be. ",
			snapshotVersion: "  gutenberg-1524-static ",
			metadata: {
				workspaceName: " Public domain fixtures ",
				authorName: " William Shakespeare ",
				labels: [" drama ", ""],
			},
		});

		expect(snapshot.connectorId).toBe("fixture-gutenberg");
		expect(snapshot.externalSourceId).toBe("1524");
		expect(snapshot.kind).toBe("notion-page");
		expect(snapshot.sourceId).toMatch(
			/^src:fixture-gutenberg-[a-f0-9]{32}:1524-[a-f0-9]{32}$/,
		);
		expect(snapshot.snapshotVersion).toBe("gutenberg-1524-static");
		expect(snapshot.snapshotId).toMatch(
			/^snapshot:src-fixture-gutenberg-[a-f0-9-]+:gutenberg-1524-static-[a-f0-9]{32}:[a-f0-9]+-[a-f0-9]{32}$/,
		);
		expect(snapshot.contentHash).toHaveLength(64);
		expect(snapshot.metadata).toEqual({
			workspaceName: "Public domain fixtures",
			authorName: "William Shakespeare",
			labels: ["drama"],
		});
	});

	it("preserves source text whitespace in snapshots, spans, and anchors", () => {
		const content = "Line 1\n\nSpeaker:\n  Line 2";
		const snapshot = createSourceSnapshot({
			connectorId: "fixture",
			externalSourceId: "whitespace-doc",
			kind: "transcript",
			title: "Whitespace Source",
			content,
		});
		const span = createSourceSpanCandidate({
			snapshot,
			spanKey: "segment-1",
			section: "Segment 1",
			locator: "00:00:01-00:00:03",
			text: "Speaker:\n  Line 2",
		});
		const extractionRun = createExtractionRun({
			snapshot,
			extractorId: "fixture-script",
			extractorVersion: "1.0.0",
			startedAt: "2026-05-19T00:00:00.000Z",
		});
		const candidate = createAttestationCandidate({
			extractionRun,
			span,
			type: "custom-transcript-claim",
			subject: "Speaker",
			predicate: "says",
			value: "Line 2",
			context: "",
			anchorText: "Speaker:\n  Line 2",
		});

		expect(snapshot.content).toBe(content);
		expect(snapshot.contentHash).toHaveLength(64);
		expect(span.text).toBe("Speaker:\n  Line 2");
		expect(candidate.type).toBe("custom-transcript-claim");
		expect(candidate.anchorText).toBe("Speaker:\n  Line 2");
		expect(
			verifyAttestationCandidate({
				candidate,
				span,
				verifiedAt: "2026-05-19T00:00:01.000Z",
			}).support.verifiedAgainstSource,
		).toBe(true);
	});

	it("keeps distinct external identities distinct after normalization", () => {
		const first = createSourceSnapshot({
			connectorId: "connector",
			externalSourceId: "doc/a",
			kind: "document",
			title: "Doc A",
			content: "Same content.",
		});
		const second = createSourceSnapshot({
			connectorId: "connector",
			externalSourceId: "doc_a",
			kind: "document",
			title: "Doc A",
			content: "Same content.",
		});

		expect(first.sourceId).not.toBe(second.sourceId);
		expect(first.externalSourceId).toBe("doc/a");
		expect(second.externalSourceId).toBe("doc_a");
	});

	it("rejects missing external identity and empty source content", () => {
		expect(() =>
			createSourceSnapshot({
				connectorId: "fixture-gutenberg",
				externalSourceId: " ",
				kind: "play",
				title: "Hamlet",
				content: "To be.",
			}),
		).toThrow(new IngestionContractError("externalSourceId is required."));

		expect(() =>
			createSourceSnapshot({
				connectorId: "fixture-gutenberg",
				externalSourceId: "1524",
				kind: "play",
				title: "Hamlet",
				content: " ",
			}),
		).toThrow(new IngestionContractError("content is required."));
	});

	it("requires useful source span locator metadata", () => {
		const snapshot = createFixtureSnapshot();

		expect(() =>
			createSourceSpanCandidate({
				snapshot,
				spanKey: "act-1",
				section: "Act 1",
				locator: " ",
				text: "Barnardo asks who is there.",
			}),
		).toThrow(new IngestionContractError("locator is required."));

		const span = createSourceSpanCandidate({
			snapshot,
			spanKey: "act-1-scene-1-lines-1-2",
			section: "Act 1 Scene 1",
			locator: "Act 1, Scene 1, lines 1-2",
			text: "Barnardo asks who is there.",
		});

		expect(span).toMatchObject({
			snapshotId: snapshot.snapshotId,
			sourceId: snapshot.sourceId,
			section: "Act 1 Scene 1",
			locator: "Act 1, Scene 1, lines 1-2",
			text: "Barnardo asks who is there.",
		});
	});

	it("rejects span candidates detached from the source snapshot text", () => {
		const snapshot = createFixtureSnapshot();

		expect(() =>
			createSourceSpanCandidate({
				snapshot,
				spanKey: "macbeth-line",
				section: "Act 1",
				locator: "Act 1, Scene 1",
				text: "Thunder and lightning.",
			}),
		).toThrow(
			new IngestionContractError(
				"Source span candidate text is not present in the source snapshot.",
			),
		);
	});

	it("keeps attestation candidates distinct from verified attestations", () => {
		const snapshot = createFixtureSnapshot();
		const span = createSourceSpanCandidate({
			snapshot,
			spanKey: "act-1-scene-1-lines-1-2",
			section: "Act 1 Scene 1",
			locator: "Act 1, Scene 1, lines 1-2",
			text: "Barnardo asks who is there.",
		});
		const extractionRun = createExtractionRun({
			snapshot,
			extractorId: "fixture-script",
			extractorVersion: "1.0.0",
			startedAt: "2026-05-19T00:00:00.000Z",
		});
		const candidate = createAttestationCandidate({
			extractionRun,
			span,
			type: "utterance",
			subject: "Barnardo",
			predicate: "asks",
			value: "who is there",
			context: "opening watch",
			anchorText: "who is there",
		});

		expect(candidate).not.toHaveProperty("support");
		expect(candidate).not.toHaveProperty("attestationId");

		const verified = verifyAttestationCandidate({
			candidate,
			span,
			verifiedAt: "2026-05-19T00:00:01.000Z",
		});

		expect(verified.attestationId).toContain("attestation:");
		expect(verified.support).toEqual({
			verifiedAgainstSource: true,
			method: "anchor-substring",
		});
	});

	it("rejects candidates whose extraction run belongs to another snapshot", () => {
		const snapshot = createFixtureSnapshot();
		const otherSnapshot = createSourceSnapshot({
			connectorId: "fixture-gutenberg",
			externalSourceId: "1533",
			kind: "play",
			title: "Macbeth",
			content: "Thunder and lightning.",
			snapshotVersion: "gutenberg-1533-static",
		});
		const span = createSourceSpanCandidate({
			snapshot,
			spanKey: "act-1-scene-1-lines-1-2",
			section: "Act 1 Scene 1",
			locator: "Act 1, Scene 1, lines 1-2",
			text: "Barnardo asks who is there.",
		});
		const extractionRun = createExtractionRun({
			snapshot: otherSnapshot,
			extractorId: "fixture-script",
			extractorVersion: "1.0.0",
			startedAt: "2026-05-19T00:00:00.000Z",
		});

		expect(() =>
			createAttestationCandidate({
				extractionRun,
				span,
				type: "utterance",
				subject: "Barnardo",
				predicate: "asks",
				value: "who is there",
				context: "opening watch",
				anchorText: "who is there",
			}),
		).toThrow(
			new IngestionContractError(
				"Extraction run snapshotId does not match source span candidate.",
			),
		);
	});

	it("rejects verification when candidate provenance names another snapshot", () => {
		const snapshot = createFixtureSnapshot();
		const span = createSourceSpanCandidate({
			snapshot,
			spanKey: "act-1-scene-1-lines-1-2",
			section: "Act 1 Scene 1",
			locator: "Act 1, Scene 1, lines 1-2",
			text: "Barnardo asks who is there.",
		});
		const extractionRun = createExtractionRun({
			snapshot,
			extractorId: "fixture-script",
			extractorVersion: "1.0.0",
			startedAt: "2026-05-19T00:00:00.000Z",
		});
		const candidate = createAttestationCandidate({
			extractionRun,
			span,
			type: "utterance",
			subject: "Barnardo",
			predicate: "asks",
			value: "who is there",
			context: "opening watch",
			anchorText: "who is there",
		});

		expect(() =>
			verifyAttestationCandidate({
				candidate: { ...candidate, snapshotId: "snapshot:other" },
				span,
				verifiedAt: "2026-05-19T00:00:01.000Z",
			}),
		).toThrow(
			new IngestionContractError(
				"Attestation candidate snapshotId does not match source span candidate.",
			),
		);
	});

	it("rejects generated candidates whose anchor is not present in the span", () => {
		const snapshot = createFixtureSnapshot();
		const span = createSourceSpanCandidate({
			snapshot,
			spanKey: "act-1-scene-1-lines-1-2",
			section: "Act 1 Scene 1",
			locator: "Act 1, Scene 1, lines 1-2",
			text: "Barnardo asks who is there.",
		});
		const extractionRun = createExtractionRun({
			snapshot,
			extractorId: "fixture-script",
			extractorVersion: "1.0.0",
			startedAt: "2026-05-19T00:00:00.000Z",
		});
		const candidate = createAttestationCandidate({
			extractionRun,
			span,
			type: "utterance",
			subject: "Hamlet",
			predicate: "mentions",
			value: "the mousetrap",
			context: "",
			anchorText: "the mousetrap",
		});

		expect(() =>
			verifyAttestationCandidate({
				candidate,
				span,
				verifiedAt: "2026-05-19T00:00:01.000Z",
			}),
		).toThrow(
			new IngestionContractError(
				"Attestation candidate anchorText is not present in the source span.",
			),
		);
	});

	it("can represent the current Gutenberg fixture through the neutral boundary", () => {
		const source = corpus.find((document) => document.sourceId === "hamlet");
		const span = source?.spans.at(0);
		const attestation = span?.attestations.at(0);

		expect(source).toBeDefined();
		expect(span).toBeDefined();
		expect(attestation).toBeDefined();

		const snapshot = createSourceSnapshot({
			connectorId: "fixture-gutenberg",
			externalSourceId: source?.sourceId ?? "",
			kind: source?.kind ?? "play",
			title: source?.title ?? "",
			content:
				source?.spans.map((sourceSpan) => sourceSpan.text).join("\n") ?? "",
			attribution: source?.attribution,
			updatedAt: source?.updatedAt,
			sourceUrl: source?.sourceUrl,
			snapshotVersion: `${source?.sourceId ?? "unknown"}-static`,
		});
		const spanCandidate = createSourceSpanCandidate({
			snapshot,
			spanKey: span?.spanId ?? "",
			section: span?.section ?? "",
			locator: span?.locator ?? "",
			text: span?.text ?? "",
		});
		const extractionRun = createExtractionRun({
			snapshot,
			extractorId: "gutenberg-fixture-import",
			extractorVersion: "1.0.0",
			startedAt: "2026-05-19T00:00:00.000Z",
		});
		const candidate = createAttestationCandidate({
			extractionRun,
			span: spanCandidate,
			type: attestation?.type ?? "passage",
			subject: attestation?.subject ?? "",
			predicate: attestation?.predicate ?? "",
			value: attestation?.value ?? "",
			context: attestation?.context ?? "",
			anchorText: attestation?.anchorText ?? "",
		});

		expect(
			verifyAttestationCandidate({
				candidate,
				span: spanCandidate,
				verifiedAt: "2026-05-19T00:00:01.000Z",
			}).support.verifiedAgainstSource,
		).toBe(true);
	});
});

function createFixtureSnapshot() {
	return createSourceSnapshot({
		connectorId: "fixture-gutenberg",
		externalSourceId: "1524",
		kind: "play",
		title: "Hamlet",
		content: "Barnardo asks who is there.",
		snapshotVersion: "gutenberg-1524-static",
	});
}

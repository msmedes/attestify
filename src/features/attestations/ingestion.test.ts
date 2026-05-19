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
			kind: "play",
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
		expect(snapshot.sourceId).toBe("src:fixture-gutenberg:1524");
		expect(snapshot.snapshotVersion).toBe("gutenberg-1524-static");
		expect(snapshot.snapshotId).toContain(
			"snapshot:src-fixture-gutenberg-1524",
		);
		expect(snapshot.contentHash).toHaveLength(64);
		expect(snapshot.metadata).toEqual({
			workspaceName: "Public domain fixtures",
			authorName: "William Shakespeare",
			labels: ["drama"],
		});
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

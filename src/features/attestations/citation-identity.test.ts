import { describe, expect, it } from "vitest";
import {
	buildCitationIdentity,
	legacyCitationHandle,
} from "./citation-identity";
import type { Attestation, SourceDocument, SourceSpan } from "./types";

describe("citation identity", () => {
	it("builds structured provenance while preserving the legacy handle", () => {
		const source = makeSource({
			snapshotVersion: "version-1",
			contentHash: "hash-1",
		});
		const span = source.spans[0] as SourceSpan;
		const attestation = span.attestations[0] as Attestation;
		const identity = buildCitationIdentity({ attestation, source, span });

		expect(legacyCitationHandle({ attestation, span })).toBe(
			"att:source-1-00001:sentence-1#source-1-00001",
		);
		expect(identity).toMatchObject({
			status: "resolvable",
			legacyHandle: "att:source-1-00001:sentence-1#source-1-00001",
			connectorId: "fixture",
			externalSourceId: "external-1",
			sourceSnapshot: {
				snapshotId: "snapshot-1",
				version: "version-1",
				contentHash: "hash-1",
			},
			span: {
				spanId: "structured-span-1",
				legacySpanId: "source-1-00001",
				locator: "paragraph 1",
			},
			attestation: {
				legacyAttestationId: "att:source-1-00001:sentence-1",
				extractionRunId: "run-1",
				extractorVersion: "1.0.0",
			},
		});
	});

	it("differs when the same external source has a different snapshot", () => {
		const sourceV1 = makeSource({
			snapshotId: "snapshot-1",
			snapshotVersion: "version-1",
			contentHash: "hash-1",
		});
		const sourceV2 = makeSource({
			snapshotId: "snapshot-2",
			snapshotVersion: "version-2",
			contentHash: "hash-2",
		});
		const spanV1 = sourceV1.spans[0] as SourceSpan;
		const spanV2 = sourceV2.spans[0] as SourceSpan;

		const firstIdentity = buildCitationIdentity({
			attestation: spanV1.attestations[0] as Attestation,
			source: sourceV1,
			span: spanV1,
		});
		const secondIdentity = buildCitationIdentity({
			attestation: spanV2.attestations[0] as Attestation,
			source: sourceV2,
			span: spanV2,
		});

		expect(firstIdentity.status).toBe("resolvable");
		expect(secondIdentity.status).toBe("resolvable");

		if (
			firstIdentity.status === "resolvable" &&
			secondIdentity.status === "resolvable"
		) {
			expect(firstIdentity.externalSourceId).toBe(
				secondIdentity.externalSourceId,
			);
			expect(firstIdentity.sourceSnapshot).not.toEqual(
				secondIdentity.sourceSnapshot,
			);
		}
	});

	it("falls back to legacy identity when snapshot authority is missing", () => {
		const source = makeSource({
			snapshotVersion: undefined,
			contentHash: undefined,
		});
		const span = source.spans[0] as SourceSpan;
		const attestation = span.attestations[0] as Attestation;

		expect(buildCitationIdentity({ attestation, source, span })).toMatchObject({
			status: "legacy",
			legacyHandle: "att:source-1-00001:sentence-1#source-1-00001",
			reason:
				"Structured citation identity is missing source snapshot version or content hash.",
		});
	});
});

function makeSource({
	contentHash,
	snapshotId = "snapshot-1",
	snapshotVersion,
}: {
	contentHash?: string;
	snapshotId?: string;
	snapshotVersion?: string;
}): SourceDocument {
	return {
		sourceId: "source-1",
		kind: "science-note",
		title: "Source One",
		attribution: "Fixture",
		updatedAt: "2026-05-19",
		ingestion: {
			connectorId: "fixture",
			externalSourceId: "external-1",
			sourceId: "structured-source-1",
			snapshotId,
			...(snapshotVersion ? { snapshotVersion } : {}),
			...(contentHash ? { contentHash } : {}),
			extractionRunId: "run-1",
			extractorVersion: "1.0.0",
		},
		spans: [
			{
				spanId: "source-1-00001",
				sourceId: "source-1",
				section: "Section",
				locator: "paragraph 1",
				text: "The source states a claim.",
				ingestion: {
					spanId: "structured-span-1",
				},
				attestations: [
					{
						id: "att:source-1-00001:sentence-1",
						type: "passage",
						subject: "Source One",
						predicate: "states",
						value: "The source states a claim.",
						context: "Section",
						anchorText: "The source states a claim.",
						ingestion: {
							status: "verified",
							method: "anchor-substring",
						},
					},
				],
			},
		],
	};
}

import type {
	Attestation,
	CitationIdentity,
	SourceDocument,
	SourceSpan,
} from "./types";

export function legacyCitationHandle({
	attestation,
	span,
}: {
	attestation: Pick<Attestation, "id">;
	span: Pick<SourceSpan, "spanId">;
}): string {
	return `${attestation.id}#${span.spanId}`;
}

export function buildCitationIdentity({
	attestation,
	source,
	span,
}: {
	attestation: Attestation;
	source: SourceDocument;
	span: SourceSpan;
}): CitationIdentity {
	const legacyHandle = legacyCitationHandle({ attestation, span });
	const sourceIngestion = source.ingestion;
	const spanIngestion = span.ingestion;

	if (!sourceIngestion || !spanIngestion) {
		return {
			status: "legacy",
			legacyHandle,
			reason:
				"Generated citation does not include structured ingestion identity.",
			span: {
				legacySpanId: span.spanId,
				locator: span.locator,
			},
			attestation: {
				legacyAttestationId: attestation.id,
			},
		};
	}

	if (!sourceIngestion.snapshotVersion && !sourceIngestion.contentHash) {
		return {
			status: "legacy",
			legacyHandle,
			reason:
				"Structured citation identity is missing source snapshot version or content hash.",
			span: {
				legacySpanId: span.spanId,
				locator: span.locator,
			},
			attestation: {
				legacyAttestationId: attestation.id,
			},
		};
	}

	return {
		status: "resolvable",
		legacyHandle,
		connectorId: sourceIngestion.connectorId,
		externalSourceId: sourceIngestion.externalSourceId,
		sourceSnapshot: {
			snapshotId: sourceIngestion.snapshotId,
			...(sourceIngestion.snapshotVersion
				? { version: sourceIngestion.snapshotVersion }
				: {}),
			...(sourceIngestion.contentHash
				? { contentHash: sourceIngestion.contentHash }
				: {}),
		},
		span: {
			spanId: spanIngestion.spanId,
			legacySpanId: span.spanId,
			locator: span.locator,
		},
		attestation: {
			attestationId: sourceIngestion.extractionRunId
				? `${sourceIngestion.extractionRunId}#${attestation.id}`
				: attestation.id,
			legacyAttestationId: attestation.id,
			...(sourceIngestion.extractionRunId
				? { extractionRunId: sourceIngestion.extractionRunId }
				: {}),
			...(sourceIngestion.extractorVersion
				? { extractorVersion: sourceIngestion.extractorVersion }
				: {}),
		},
	};
}

export function citationLabel(index: number): string {
	return `[${index + 1}]`;
}

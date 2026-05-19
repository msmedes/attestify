import { createHash } from "node:crypto";
import type { AttestationType, SourceKind } from "./types";

export type ConnectorMetadata = {
	workspaceId?: string;
	workspaceName?: string;
	authorId?: string;
	authorName?: string;
	sourceUrl?: string;
	labels?: string[];
};

export type SourceDocumentInput = {
	connectorId: string;
	externalSourceId: string;
	kind: SourceKind;
	title: string;
	content: string;
	attribution?: string;
	updatedAt?: string;
	sourceUrl?: string;
	snapshotVersion?: string;
	metadata?: ConnectorMetadata;
};

export type SourceSnapshot = {
	sourceId: string;
	snapshotId: string;
	connectorId: string;
	externalSourceId: string;
	kind: SourceKind;
	title: string;
	content: string;
	contentHash: string;
	snapshotVersion: string;
	attribution?: string;
	updatedAt?: string;
	sourceUrl?: string;
	metadata?: ConnectorMetadata;
};

export type SourceSpanCandidateInput = {
	snapshot: SourceSnapshot;
	spanKey: string;
	section: string;
	locator: string;
	text: string;
};

export type SourceSpanCandidate = {
	spanId: string;
	snapshotId: string;
	sourceId: string;
	section: string;
	locator: string;
	text: string;
};

export type ExtractionRun = {
	extractionRunId: string;
	snapshotId: string;
	extractorId: string;
	extractorVersion: string;
	startedAt: string;
};

export type AttestationCandidate = {
	candidateId: string;
	extractionRunId: string;
	spanId: string;
	type: AttestationType;
	subject: string;
	predicate: string;
	value: string;
	context: string;
	anchorText: string;
};

export type VerifiedAttestation = AttestationCandidate & {
	attestationId: string;
	verifiedAt: string;
	support: {
		verifiedAgainstSource: true;
		method: "anchor-substring";
	};
};

export class IngestionContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IngestionContractError";
	}
}

export function createSourceSnapshot(
	input: SourceDocumentInput,
): SourceSnapshot {
	const connectorId = requireNonEmpty(input.connectorId, "connectorId");
	const externalSourceId = requireNonEmpty(
		input.externalSourceId,
		"externalSourceId",
	);
	const title = requireNonEmpty(input.title, "title");
	const content = requireNonEmpty(input.content, "content");
	const contentHash = sha256(content);
	const sourceId = stableId(["src", connectorId, externalSourceId]);
	const snapshotVersion =
		normalizeOptional(input.snapshotVersion) ?? `sha256:${contentHash}`;

	return {
		sourceId,
		snapshotId: stableId(["snapshot", sourceId, snapshotVersion, contentHash]),
		connectorId,
		externalSourceId,
		kind: input.kind,
		title,
		content,
		contentHash,
		snapshotVersion,
		...optionalField("attribution", input.attribution),
		...optionalField("updatedAt", input.updatedAt),
		...optionalField("sourceUrl", input.sourceUrl),
		...optionalMetadata(input.metadata),
	};
}

export function createSourceSpanCandidate({
	locator,
	section,
	snapshot,
	spanKey,
	text,
}: SourceSpanCandidateInput): SourceSpanCandidate {
	const normalizedSection = requireNonEmpty(section, "section");
	const normalizedLocator = requireNonEmpty(locator, "locator");
	const normalizedSpanKey = requireNonEmpty(spanKey, "spanKey");
	const normalizedText = requireNonEmpty(text, "text");

	return {
		spanId: stableId(["span", snapshot.snapshotId, normalizedSpanKey]),
		snapshotId: snapshot.snapshotId,
		sourceId: snapshot.sourceId,
		section: normalizedSection,
		locator: normalizedLocator,
		text: normalizedText,
	};
}

export function createExtractionRun({
	extractorId,
	extractorVersion,
	snapshot,
	startedAt,
}: {
	extractorId: string;
	extractorVersion: string;
	snapshot: SourceSnapshot;
	startedAt: string;
}): ExtractionRun {
	const normalizedExtractorId = requireNonEmpty(extractorId, "extractorId");
	const normalizedExtractorVersion = requireNonEmpty(
		extractorVersion,
		"extractorVersion",
	);
	const normalizedStartedAt = requireNonEmpty(startedAt, "startedAt");

	return {
		extractionRunId: stableId([
			"extraction",
			snapshot.snapshotId,
			normalizedExtractorId,
			normalizedExtractorVersion,
			normalizedStartedAt,
		]),
		snapshotId: snapshot.snapshotId,
		extractorId: normalizedExtractorId,
		extractorVersion: normalizedExtractorVersion,
		startedAt: normalizedStartedAt,
	};
}

export function createAttestationCandidate({
	anchorText,
	context,
	extractionRun,
	predicate,
	span,
	subject,
	type,
	value,
}: {
	anchorText: string;
	context: string;
	extractionRun: ExtractionRun;
	predicate: string;
	span: SourceSpanCandidate;
	subject: string;
	type: AttestationType;
	value: string;
}): AttestationCandidate {
	const normalizedSubject = requireNonEmpty(subject, "subject");
	const normalizedPredicate = requireNonEmpty(predicate, "predicate");
	const normalizedValue = requireNonEmpty(value, "value");
	const normalizedAnchorText = requireNonEmpty(anchorText, "anchorText");

	return {
		candidateId: stableId([
			"candidate",
			extractionRun.extractionRunId,
			span.spanId,
			type,
			normalizedSubject,
			normalizedPredicate,
			normalizedValue,
			normalizedAnchorText,
		]),
		extractionRunId: extractionRun.extractionRunId,
		spanId: span.spanId,
		type,
		subject: normalizedSubject,
		predicate: normalizedPredicate,
		value: normalizedValue,
		context: normalizeOptional(context) ?? "",
		anchorText: normalizedAnchorText,
	};
}

export function verifyAttestationCandidate({
	candidate,
	span,
	verifiedAt,
}: {
	candidate: AttestationCandidate;
	span: SourceSpanCandidate;
	verifiedAt: string;
}): VerifiedAttestation {
	const normalizedVerifiedAt = requireNonEmpty(verifiedAt, "verifiedAt");

	if (candidate.spanId !== span.spanId) {
		throw new IngestionContractError(
			"Attestation candidate spanId does not match source span candidate.",
		);
	}

	if (!span.text.includes(candidate.anchorText)) {
		throw new IngestionContractError(
			"Attestation candidate anchorText is not present in the source span.",
		);
	}

	return {
		...candidate,
		attestationId: stableId(["attestation", candidate.candidateId]),
		verifiedAt: normalizedVerifiedAt,
		support: {
			verifiedAgainstSource: true,
			method: "anchor-substring",
		},
	};
}

function requireNonEmpty(value: string, fieldName: string): string {
	const normalized = normalizeOptional(value);

	if (!normalized) {
		throw new IngestionContractError(`${fieldName} is required.`);
	}

	return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
	const normalized = value?.replace(/\s+/g, " ").trim();

	return normalized || undefined;
}

function optionalField<Key extends string>(
	key: Key,
	value: string | undefined,
): Partial<Record<Key, string>> {
	const normalized = normalizeOptional(value);

	return normalized ? { [key]: normalized } : {};
}

function optionalMetadata(metadata: ConnectorMetadata | undefined): {
	metadata?: ConnectorMetadata;
} {
	if (!metadata) {
		return {};
	}

	const normalized: ConnectorMetadata = {
		...optionalField("workspaceId", metadata.workspaceId),
		...optionalField("workspaceName", metadata.workspaceName),
		...optionalField("authorId", metadata.authorId),
		...optionalField("authorName", metadata.authorName),
		...optionalField("sourceUrl", metadata.sourceUrl),
		...(metadata.labels?.length
			? { labels: metadata.labels.map((label) => label.trim()).filter(Boolean) }
			: {}),
	};

	return Object.keys(normalized).length > 0 ? { metadata: normalized } : {};
}

function stableId(parts: string[]): string {
	return parts.map((part) => slugPart(part)).join(":");
}

function slugPart(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "unknown"
	);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

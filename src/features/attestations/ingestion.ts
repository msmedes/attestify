import { createHash } from "node:crypto";

export type IngestionSourceKind = string;
export type IngestionAttestationType = string;

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
	kind: IngestionSourceKind;
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
	kind: IngestionSourceKind;
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
	sourceOffset?: number;
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
	snapshotId: string;
	spanId: string;
	type: IngestionAttestationType;
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

export type ExtractionSettings = Record<
	string,
	boolean | number | string | null | string[]
>;

export type AttestationCandidateDraft = {
	type: IngestionAttestationType;
	subject: string;
	predicate: string;
	value: string;
	context: string;
	anchorText: string;
};

export type ExtractionCacheKey = {
	key: string;
	snapshotId: string;
	spanId: string;
	extractorId: string;
	extractorVersion: string;
	settingsHash: string;
};

export type CachedExtractionResult = {
	cacheKey: ExtractionCacheKey;
	candidates: AttestationCandidate[];
	cachedAt: string;
};

export type AttestationExtractor = {
	extractorId: string;
	extractorVersion: string;
	extract(input: {
		snapshot: SourceSnapshot;
		span: SourceSpanCandidate;
		settings: ExtractionSettings;
	}): Promise<AttestationCandidateDraft[]> | AttestationCandidateDraft[];
};

export type AttestationVerifier = {
	verify(input: { candidate: AttestationCandidate; span: SourceSpanCandidate }):
		| Promise<
				| {
						status: "verified";
						method: VerifiedAttestation["support"]["method"];
				  }
				| { status: "rejected"; reason: string }
		  >
		| (
				| {
						status: "verified";
						method: VerifiedAttestation["support"]["method"];
				  }
				| { status: "rejected"; reason: string }
		  );
};

export type ExtractionCache = {
	get(cacheKey: ExtractionCacheKey): CachedExtractionResult | undefined;
	set(result: CachedExtractionResult): void;
};

export type AttestationLifecycleRecord =
	| {
			state: "cache-hit";
			cacheKey: ExtractionCacheKey;
			candidateCount: number;
	  }
	| {
			state: "raw-candidate";
			cacheKey: ExtractionCacheKey;
			candidate: AttestationCandidate;
	  }
	| {
			state: "verified-candidate";
			cacheKey: ExtractionCacheKey;
			candidate: AttestationCandidate;
			method: VerifiedAttestation["support"]["method"];
	  }
	| {
			state: "promoted";
			cacheKey: ExtractionCacheKey;
			attestation: VerifiedAttestation;
	  }
	| {
			state: "rejected";
			cacheKey: ExtractionCacheKey;
			candidate: AttestationCandidate;
			reason: string;
	  };

export type LazyExtractionLifecycleResult = {
	records: AttestationLifecycleRecord[];
	promotedAttestations: VerifiedAttestation[];
};

export class InMemoryExtractionCache implements ExtractionCache {
	readonly results = new Map<string, CachedExtractionResult>();

	get(cacheKey: ExtractionCacheKey): CachedExtractionResult | undefined {
		return this.results.get(cacheKey.key);
	}

	set(result: CachedExtractionResult): void {
		this.results.set(result.cacheKey.key, result);
	}
}

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
	const kind = requireNonEmpty(input.kind, "kind");
	const content = requireSourceText(input.content, "content");
	const contentHash = sha256(content);
	const sourceId = stableId("src", [connectorId, externalSourceId]);
	const snapshotVersion =
		normalizeOptional(input.snapshotVersion) ?? `sha256:${contentHash}`;

	return {
		sourceId,
		snapshotId: stableId("snapshot", [sourceId, snapshotVersion, contentHash]),
		connectorId,
		externalSourceId,
		kind,
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
	sourceOffset,
	text,
}: SourceSpanCandidateInput): SourceSpanCandidate {
	const normalizedSection = requireNonEmpty(section, "section");
	const normalizedLocator = requireNonEmpty(locator, "locator");
	const normalizedSpanKey = requireNonEmpty(spanKey, "spanKey");
	const normalizedText = requireSourceText(text, "text");

	if (
		sourceOffset !== undefined &&
		snapshot.content.slice(
			sourceOffset,
			sourceOffset + normalizedText.length,
		) !== normalizedText
	) {
		throw new IngestionContractError(
			"Source span candidate offset does not match the source snapshot.",
		);
	}

	if (
		sourceOffset === undefined &&
		!snapshot.content.includes(normalizedText)
	) {
		throw new IngestionContractError(
			"Source span candidate text is not present in the source snapshot.",
		);
	}

	return {
		spanId: stableId("span", [snapshot.snapshotId, normalizedSpanKey]),
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
		extractionRunId: stableId("extraction", [
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

export function createExtractionCacheKey({
	extractorId,
	extractorVersion,
	settings,
	snapshot,
	span,
}: {
	extractorId: string;
	extractorVersion: string;
	settings?: ExtractionSettings;
	snapshot: SourceSnapshot;
	span: SourceSpanCandidate;
}): ExtractionCacheKey {
	const normalizedExtractorId = requireNonEmpty(extractorId, "extractorId");
	const normalizedExtractorVersion = requireNonEmpty(
		extractorVersion,
		"extractorVersion",
	);

	if (snapshot.snapshotId !== span.snapshotId) {
		throw new IngestionContractError(
			"Extraction cache key snapshotId does not match source span candidate.",
		);
	}

	const settingsJson = stableSettingsJson(settings ?? {});
	const settingsHash = sha256(settingsJson);
	const key = stableId("extract-cache", [
		snapshot.snapshotId,
		span.spanId,
		normalizedExtractorId,
		normalizedExtractorVersion,
		settingsHash,
	]);

	return {
		key,
		snapshotId: snapshot.snapshotId,
		spanId: span.spanId,
		extractorId: normalizedExtractorId,
		extractorVersion: normalizedExtractorVersion,
		settingsHash,
	};
}

export async function runLazyExtractionLifecycle({
	cache,
	extractor,
	settings = {},
	snapshot,
	span,
	startedAt,
	verifiedAt,
	verifier,
}: {
	cache: ExtractionCache;
	extractor: AttestationExtractor;
	settings?: ExtractionSettings;
	snapshot: SourceSnapshot;
	span: SourceSpanCandidate;
	startedAt: string;
	verifiedAt: string;
	verifier: AttestationVerifier;
}): Promise<LazyExtractionLifecycleResult> {
	const cacheKey = createExtractionCacheKey({
		extractorId: extractor.extractorId,
		extractorVersion: extractor.extractorVersion,
		settings,
		snapshot,
		span,
	});
	const extractionRun = createExtractionRun({
		snapshot,
		extractorId: extractor.extractorId,
		extractorVersion: extractor.extractorVersion,
		startedAt,
	});
	const records: AttestationLifecycleRecord[] = [];
	const cached = cache.get(cacheKey);
	const candidates =
		cached?.candidates ??
		(
			await extractor.extract({
				snapshot,
				span,
				settings,
			})
		).map((draft) =>
			createAttestationCandidate({
				extractionRun,
				span,
				...draft,
			}),
		);

	if (!cached) {
		cache.set({
			cacheKey,
			candidates,
			cachedAt: startedAt,
		});
	}

	if (cached) {
		records.push({
			state: "cache-hit",
			cacheKey,
			candidateCount: candidates.length,
		});
	}

	const promotedAttestations: VerifiedAttestation[] = [];

	for (const candidate of candidates) {
		ensureCandidateBelongsToSpan(candidate, span);
		records.push({
			state: "raw-candidate",
			cacheKey,
			candidate,
		});

		const verification = await verifier.verify({ candidate, span });

		if (verification.status === "rejected") {
			records.push({
				state: "rejected",
				cacheKey,
				candidate,
				reason: verification.reason,
			});
			continue;
		}

		records.push({
			state: "verified-candidate",
			cacheKey,
			candidate,
			method: verification.method,
		});

		const promoted = verifyAttestationCandidate({
			candidate,
			span,
			verifiedAt,
		});
		records.push({
			state: "promoted",
			cacheKey,
			attestation: promoted,
		});
		promotedAttestations.push(promoted);
	}

	return {
		records,
		promotedAttestations,
	};
}

export function promoteVerifiedAttestation({
	candidate,
	span,
	verifiedAt,
}: {
	candidate: AttestationCandidate;
	span: SourceSpanCandidate;
	verifiedAt: string;
}): VerifiedAttestation {
	return verifyAttestationCandidate({
		candidate,
		span,
		verifiedAt,
	});
}

export function rejectAttestationCandidate({
	candidate,
	reason,
}: {
	candidate: AttestationCandidate;
	reason: string;
}): {
	state: "rejected";
	candidate: AttestationCandidate;
	reason: string;
} {
	return {
		state: "rejected",
		candidate,
		reason: requireNonEmpty(reason, "reason"),
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
	type: IngestionAttestationType;
	value: string;
}): AttestationCandidate {
	const normalizedSubject = requireNonEmpty(subject, "subject");
	const normalizedPredicate = requireNonEmpty(predicate, "predicate");
	const normalizedType = requireNonEmpty(type, "type");
	const normalizedValue = requireNonEmpty(value, "value");
	const normalizedAnchorText = requireSourceText(anchorText, "anchorText");

	if (extractionRun.snapshotId !== span.snapshotId) {
		throw new IngestionContractError(
			"Extraction run snapshotId does not match source span candidate.",
		);
	}

	return {
		candidateId: stableId("candidate", [
			extractionRun.extractionRunId,
			span.spanId,
			normalizedType,
			normalizedSubject,
			normalizedPredicate,
			normalizedValue,
			normalizedAnchorText,
		]),
		extractionRunId: extractionRun.extractionRunId,
		snapshotId: extractionRun.snapshotId,
		spanId: span.spanId,
		type: normalizedType,
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

	if (candidate.snapshotId !== span.snapshotId) {
		throw new IngestionContractError(
			"Attestation candidate snapshotId does not match source span candidate.",
		);
	}

	if (!span.text.includes(candidate.anchorText)) {
		throw new IngestionContractError(
			"Attestation candidate anchorText is not present in the source span.",
		);
	}

	return {
		...candidate,
		attestationId: stableId("attestation", [candidate.candidateId]),
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

function requireSourceText(value: string, fieldName: string): string {
	if (!value.trim()) {
		throw new IngestionContractError(`${fieldName} is required.`);
	}

	return value;
}

function ensureCandidateBelongsToSpan(
	candidate: AttestationCandidate,
	span: SourceSpanCandidate,
): void {
	if (candidate.spanId !== span.spanId) {
		throw new IngestionContractError(
			"Cached attestation candidate spanId does not match source span candidate.",
		);
	}

	if (candidate.snapshotId !== span.snapshotId) {
		throw new IngestionContractError(
			"Cached attestation candidate snapshotId does not match source span candidate.",
		);
	}
}

function normalizeOptional(value: string | undefined): string | undefined {
	const normalized = value?.replace(/\s+/g, " ").trim();

	return normalized || undefined;
}

function stableSettingsJson(settings: ExtractionSettings): string {
	const entries = Object.entries(settings)
		.filter(
			(entry): entry is [string, NonNullable<ExtractionSettings[string]>] =>
				entry[1] !== undefined,
		)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => [
			key,
			Array.isArray(value) ? [...value].sort() : value,
		]);

	return JSON.stringify(Object.fromEntries(entries));
}

function optionalField<Key extends string>(
	key: Key,
	value: string | undefined,
): Partial<Record<Key, string>> {
	const normalized = normalizeOptional(value);

	if (!normalized) {
		return {};
	}

	const field = {} as Record<Key, string>;
	field[key] = normalized;

	return field;
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

function stableId(namespace: string, parts: string[]): string {
	return [namespace, ...parts.map((part) => stableIdPart(part))].join(":");
}

function stableIdPart(value: string): string {
	const slug =
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "opaque";

	return `${slug}-${sha256(value).slice(0, 32)}`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

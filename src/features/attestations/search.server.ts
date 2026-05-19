import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { LocalIndex, type MetadataTypes } from "vectra";
import { findSource, findSpan, getCorpusStats, listSpans } from "./corpus";
import { tokenize } from "./embed";
import {
	type EmbeddingConfig,
	embedCorpusTexts,
	embeddingConfigKey,
	embedQueryText,
	getEmbeddingConfig,
} from "./embeddings.server";
import type {
	Attestation,
	CitationUnit,
	RetrievalChunk,
	SearchResponse,
	SourceKind,
	SourceSpan,
} from "./types";

type SpanIndexMetadata = {
	[key: string]: MetadataTypes;
	sourceId: string;
	spanId: string;
	kind: SourceKind;
	title: string;
	section: string;
	locator: string;
};

const index = new LocalIndex<SpanIndexMetadata>(
	path.join(process.cwd(), ".data", "span-index"),
);
const INDEX_CONFIG_PATH = path.join(
	process.cwd(),
	".data",
	"span-index-config.json",
);
const EMBEDDING_CACHE_PATH = path.join(
	process.cwd(),
	".data",
	"span-embeddings.json",
);

const MAX_CITATIONS = 6;
const DEFAULT_CHUNK_LIMIT = 5;
const DEFAULT_CITATION_LIMIT = MAX_CITATIONS;
const MIN_CITATION_SCORE = 0.14;
const RELATIVE_CITATION_FLOOR = 0.45;

type SearchCorpusWithQueriesOptions = {
	query: string;
	retrievalQueries: string[];
	chunkLimit?: number;
	citationLimit?: number;
	citationScoreFloor?: number;
};

export async function searchCorpus(query: string): Promise<SearchResponse> {
	return searchCorpusWithQueries({
		query,
		retrievalQueries: [query],
	});
}

export async function populateSearchIndex() {
	await ensureIndex();
}

export async function searchCorpusWithQueries({
	query,
	retrievalQueries,
	chunkLimit = DEFAULT_CHUNK_LIMIT,
	citationLimit = DEFAULT_CITATION_LIMIT,
	citationScoreFloor = MIN_CITATION_SCORE,
}: SearchCorpusWithQueriesOptions): Promise<SearchResponse> {
	await ensureIndex();

	const normalizedRetrievalQueries = normalizeRetrievalQueries([
		query,
		...retrievalQueries,
	]);
	const embeddingConfig = getEmbeddingConfig();
	const scoringQuery = normalizedRetrievalQueries.join(" ");
	const vectorScores = await queryVectorScores(
		normalizedRetrievalQueries,
		embeddingConfig,
	);
	const retrievalChunks = listSpans()
		.flatMap((span) => {
			const source = findSource(span.sourceId);

			if (!source) {
				return [];
			}

			const lexicalScore = Math.max(
				...normalizedRetrievalQueries.map((retrievalQuery) =>
					spanLexicalScore(retrievalQuery, span, source.title),
				),
			);
			const vectorScore = vectorScores.get(span.spanId) ?? 0;
			const score = lexicalScore * 0.75 + vectorScore * 0.25;

			if (score <= 0) {
				return [];
			}

			return [
				{
					spanId: span.spanId,
					sourceId: source.sourceId,
					title: source.title,
					kind: source.kind,
					section: span.section,
					locator: span.locator,
					text: span.text,
					score: roundScore(score),
				} satisfies RetrievalChunk,
			];
		})
		.sort((left, right) => right.score - left.score)
		.slice(0, chunkLimit);

	const citationCandidates = retrievalChunks
		.flatMap((chunk) => {
			const span = findSpan(chunk.spanId);
			const source = findSource(chunk.sourceId);

			if (!span || !source) {
				return [];
			}

			return span.attestations.map((attestation) =>
				buildCitationUnit({
					attestation,
					span,
					query: scoringQuery,
					retrievalScore: chunk.score,
				}),
			);
		})
		.sort((left, right) => right.score - left.score);
	const citations = selectCitationUnits(scoringQuery, citationCandidates, {
		limit: citationLimit,
		minScore: citationScoreFloor,
	});

	return {
		query,
		retrievalQueries: normalizedRetrievalQueries,
		answerLines: citations.slice(0, 4).map(formatAnswerLine),
		citations,
		retrievalChunks,
		corpusStats: getCorpusStats(),
	};
}

async function queryVectorScores(
	queries: string[],
	embeddingConfig: EmbeddingConfig,
): Promise<Map<string, number>> {
	const vectorScores = new Map<string, number>();

	for (const query of queries) {
		const vector = await embedQueryText({
			config: embeddingConfig,
			text: query,
		});
		const results = await index.queryItems(vector, query, 50);

		for (const result of results) {
			const spanId = result.item.metadata.spanId;
			const currentScore = vectorScores.get(spanId) ?? 0;

			if (result.score > currentScore) {
				vectorScores.set(spanId, result.score);
			}
		}
	}

	return vectorScores;
}

function normalizeRetrievalQueries(queries: string[]): string[] {
	const seen = new Set<string>();
	const normalized = [];

	for (const query of queries) {
		const compact = query.replace(/\s+/g, " ").trim();
		const key = compact.toLowerCase();

		if (!compact || seen.has(key)) {
			continue;
		}

		seen.add(key);
		normalized.push(compact.slice(0, 180));
	}

	return normalized.slice(0, 6);
}

function selectCitationUnits(
	query: string,
	candidates: CitationUnit[],
	options: {
		limit: number;
		minScore: number;
	},
): CitationUnit[] {
	const verifiedCandidates = candidates.filter(
		(candidate) => candidate.support.verifiedAgainstSource,
	);
	const requestedSubject = extractRequestedSubject(query);
	const exactSubjectCandidates = requestedSubject
		? verifiedCandidates.filter(
				(candidate) =>
					candidate.attestation.subject.toLowerCase() === requestedSubject,
			)
		: [];
	const subjectMatchedCandidates = verifiedCandidates.filter(
		(candidate) => tokenOverlap(query, candidate.attestation.subject) > 0,
	);
	const candidatePool =
		exactSubjectCandidates.length > 0
			? exactSubjectCandidates
			: subjectMatchedCandidates.length > 0
				? subjectMatchedCandidates
				: verifiedCandidates;

	const topScore = candidatePool.at(0)?.score ?? 0;
	const scoreFloor = Math.max(
		options.minScore,
		topScore * RELATIVE_CITATION_FLOOR,
	);
	const selected = candidatePool
		.filter((candidate) => candidate.score >= scoreFloor)
		.slice(0, options.limit);

	return selected.length > 0
		? selected
		: candidatePool.slice(0, Math.min(2, candidatePool.length));
}

async function ensureIndex() {
	const spans = listSpans();
	const embeddingConfig = getEmbeddingConfig();
	const indexConfig = readIndexConfig();
	const isCreated = await index.isIndexCreated();
	const stats = isCreated ? await index.getIndexStats() : null;

	if (
		isCreated &&
		stats?.items === spans.length &&
		indexConfig?.embeddingConfigKey === embeddingConfigKey(embeddingConfig)
	) {
		return;
	}

	console.info(
		"[attestation-rag:retrieval]",
		JSON.stringify({
			event: "rebuild-index",
			embeddingConfig,
			spans: spans.length,
		}),
	);

	await index.createIndex({
		version: 1,
		deleteIfExists: true,
		metadata_config: {
			indexed: ["sourceId", "spanId", "kind"],
		},
	});

	const searchableItems = spans.map((span) => {
		const source = findSource(span.sourceId);
		const text = [
			source?.title,
			source?.kind,
			span.section,
			span.locator,
			span.text,
			...span.attestations.flatMap((attestation) => [
				attestation.type,
				attestation.subject,
				attestation.predicate,
				attestation.value,
				attestation.context,
				attestation.anchorText,
			]),
		]
			.filter(Boolean)
			.join(" ");

		return {
			id: span.spanId,
			source,
			span,
			text,
		};
	});
	const embeddings = await embedCorpusTexts({
		cachePath: EMBEDDING_CACHE_PATH,
		config: embeddingConfig,
		items: searchableItems.map((item) => ({
			id: item.id,
			text: item.text,
		})),
	});

	await index.batchInsertItems(
		searchableItems.map(({ id, source, span }) => {
			const vector = embeddings.get(id);

			if (!vector) {
				throw new Error(`Missing embedding for span ${id}.`);
			}

			return {
				id,
				vector,
				metadata: {
					sourceId: span.sourceId,
					spanId: span.spanId,
					kind: source?.kind ?? "science-note",
					title: source?.title ?? "Unknown source",
					section: span.section,
					locator: span.locator,
				} satisfies SpanIndexMetadata,
			};
		}),
	);

	await writeIndexConfig({
		embeddingConfigKey: embeddingConfigKey(embeddingConfig),
		embeddingConfig,
		spans: spans.length,
	});
}

function readIndexConfig(): {
	embeddingConfigKey: string;
	embeddingConfig: EmbeddingConfig;
	spans: number;
} | null {
	if (!existsSync(INDEX_CONFIG_PATH)) {
		return null;
	}

	return JSON.parse(readFileSync(INDEX_CONFIG_PATH, "utf8")) as {
		embeddingConfigKey: string;
		embeddingConfig: EmbeddingConfig;
		spans: number;
	};
}

async function writeIndexConfig(config: {
	embeddingConfigKey: string;
	embeddingConfig: EmbeddingConfig;
	spans: number;
}) {
	await mkdir(path.dirname(INDEX_CONFIG_PATH), { recursive: true });
	await writeFile(INDEX_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function buildCitationUnit({
	attestation,
	span,
	query,
	retrievalScore,
}: {
	attestation: Attestation;
	span: SourceSpan;
	query: string;
	retrievalScore: number;
}): CitationUnit {
	const source = findSource(span.sourceId);

	if (!source) {
		throw new Error(`Missing source for span ${span.spanId}`);
	}

	return {
		attestation,
		source: {
			sourceId: source.sourceId,
			title: source.title,
			kind: source.kind,
			attribution: source.attribution,
			updatedAt: source.updatedAt,
			sourceUrl: source.sourceUrl,
		},
		span: {
			spanId: span.spanId,
			section: span.section,
			locator: span.locator,
			text: span.text,
		},
		citationHandle: `${attestation.id}#${span.spanId}`,
		support: {
			verifiedAgainstSource: isAnchorInSpan(attestation.anchorText, span.text),
			method: "anchor substring check over source span",
		},
		score: roundScore(
			retrievalScore * 0.55 + attestationOverlap(query, attestation) * 0.45,
		),
	};
}

function attestationOverlap(query: string, attestation: Attestation): number {
	return tokenOverlap(
		query,
		[
			attestation.type,
			attestation.subject,
			attestation.predicate,
			attestation.value,
			attestation.context,
			attestation.anchorText,
		].join(" "),
	);
}

function spanLexicalScore(
	query: string,
	span: SourceSpan,
	sourceTitle: string,
): number {
	return tokenOverlap(
		query,
		[
			sourceTitle,
			span.section,
			span.locator,
			span.text,
			...span.attestations.flatMap((attestation) => [
				attestation.subject,
				attestation.predicate,
				attestation.value,
				attestation.anchorText,
			]),
		].join(" "),
	);
}

function extractRequestedSubject(query: string): string | null {
	const match = query
		.toLowerCase()
		.match(
			/\b(?:what|where|why|how)\s+(?:did|does|do)\s+([a-z ]+?)\s+(?:say|ask|exclaim|use)\b/,
		);

	return match?.[1]?.trim() ?? null;
}

function tokenOverlap(query: string, target: string): number {
	const queryTokens = new Set(tokenize(query));
	const targetTokens = new Set(tokenize(target));

	if (queryTokens.size === 0 || targetTokens.size === 0) {
		return 0;
	}

	let overlap = 0;

	for (const token of queryTokens) {
		if (targetTokens.has(token)) {
			overlap += 1;
		}
	}

	return overlap / queryTokens.size;
}

function isAnchorInSpan(anchor: string, spanText: string): boolean {
	return normalizeForMatch(spanText).includes(normalizeForMatch(anchor));
}

function normalizeForMatch(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatAnswerLine(citation: CitationUnit): string {
	const { attestation } = citation;

	return `${attestation.subject} ${attestation.predicate} ${attestation.value} [${citation.citationHandle}]`;
}

function roundScore(score: number): number {
	return Math.round(score * 1000) / 1000;
}

import { chat } from "@tanstack/ai";
import {
	OPENAI_CHAT_MODELS,
	type OpenAIChatModel,
	openaiText,
} from "@tanstack/ai-openai";
import { z } from "zod";
import { tokenize } from "./embed";
import { getOpenAiUnavailableReason } from "./env.server";
import { tryRecordQueryRun } from "./history.server";
import { searchCorpusWithQueries } from "./search.server";
import type {
	AiAnswer,
	AiAnswerSegment,
	AiTraceStep,
	CitationUnit,
	SearchResponse,
} from "./types";

type ModelSegment =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "citation";
			text?: string;
			citationHandle: string;
	  };

type RetrievalPlan = {
	queries: string[];
	error?: string;
	traceStep: AiTraceStep;
};

type GeneratedAnswer = {
	answer: AiAnswer;
	traceStep: AiTraceStep;
};

type RerankedCitations = {
	citations: CitationUnit[];
	traceStep: AiTraceStep;
};

const retrievalPlanSchema = z.object({
	queries: z.array(z.string()).min(1).max(5),
});

const rerankSchema = z.object({
	selected: z
		.array(
			z.object({
				citationHandle: z.string(),
				relevance: z.number().min(0).max(1),
				rationale: z.string(),
			}),
		)
		.min(1)
		.max(8),
});

const aiAnswerSchema = z.object({
	claims: z
		.array(
			z.object({
				text: z.string(),
				citationHandles: z.array(z.string()).min(1),
			}),
		)
		.min(1),
});

type ModelClaim = z.infer<typeof aiAnswerSchema>["claims"][number];

export async function answerCorpus(query: string): Promise<SearchResponse> {
	const traceSteps: AiTraceStep[] = [];
	const openAiUnavailableReason = getOpenAiUnavailableReason();

	if (openAiUnavailableReason) {
		const search = await searchCorpusWithQueries({
			query,
			retrievalQueries: [query],
		});
		traceSteps.push({
			stage: "config",
			status: "skipped",
			error: openAiUnavailableReason,
		});

		const response = {
			...search,
			aiTrace: { steps: traceSteps },
			aiAnswer: {
				status: "unavailable",
				message: openAiUnavailableReason,
			},
		} satisfies SearchResponse;
		tryRecordQueryRun(response);

		return response;
	}

	const retrievalPlan = await generateRetrievalPlan(query);
	traceSteps.push(retrievalPlan.traceStep);
	const search = await searchCorpusWithQueries({
		query,
		retrievalQueries: retrievalPlan.queries,
		chunkLimit: 40,
		citationLimit: 30,
		citationScoreFloor: 0,
	});
	if (search.aiTrace) {
		traceSteps.push(...search.aiTrace.steps);
	}
	traceSteps.push({
		stage: "retrieval",
		status: "ready",
		input: {
			queries: search.retrievalQueries,
		},
		output: {
			chunks: search.retrievalChunks.map((chunk) => ({
				spanId: chunk.spanId,
				sourceId: chunk.sourceId,
				section: chunk.section,
				locator: chunk.locator,
				score: chunk.score,
			})),
			citationHandles: search.citations.map(
				(citation) => citation.citationHandle,
			),
		},
	});

	if (retrievalPlan.error) {
		const response = {
			...search,
			aiTrace: { steps: traceSteps },
			aiAnswer: {
				status: "unavailable",
				message: retrievalPlan.error,
			},
		} satisfies SearchResponse;
		tryRecordQueryRun(response);

		return response;
	}

	const reranked = await rerankCitations(query, search.citations);
	traceSteps.push(reranked.traceStep);
	const generatedAnswer = await generateAiAnswer(query, reranked.citations);
	traceSteps.push(generatedAnswer.traceStep);

	const response = {
		...search,
		citations: reranked.citations,
		aiTrace: { steps: traceSteps },
		aiAnswer: generatedAnswer.answer,
	};
	tryRecordQueryRun(response);

	return response;
}

async function generateRetrievalPlan(query: string): Promise<RetrievalPlan> {
	const model = getOpenAIModel();
	const startedAt = performance.now();

	try {
		const retrievalPlan = await chat({
			adapter: openaiText(model),
			outputSchema: retrievalPlanSchema,
			systemPrompts: [
				[
					"You expand a user question into source-retrieval queries.",
					"Do not answer the question.",
					"Do not invent citation handles.",
					"Write queries that are likely to match literal wording in arbitrary source documents.",
					"Include names, objects, events, synonyms, and surface phrases a document might contain.",
					"Return 3 to 5 queries.",
				].join(" "),
			],
			messages: [
				{
					role: "user",
					content: query,
				},
			],
		});

		const plan = {
			queries: normalizePlanQueries(query, retrievalPlan.queries),
		};
		const traceStep: AiTraceStep = {
			stage: "retrieval-plan",
			status: "ready",
			model,
			durationMs: elapsedMs(startedAt),
			input: { query },
			output: plan,
		};
		logTraceStep(traceStep);

		return {
			...plan,
			traceStep,
		};
	} catch (error) {
		const message =
			error instanceof Error
				? `AI retrieval planning failed: ${error.message}`
				: "AI retrieval planning failed.";
		const traceStep: AiTraceStep = {
			stage: "retrieval-plan",
			status: "failed",
			model,
			durationMs: elapsedMs(startedAt),
			input: { query },
			error: message,
		};
		logTraceStep(traceStep);

		return {
			queries: [query],
			error: message,
			traceStep,
		};
	}
}

function normalizePlanQueries(
	originalQuery: string,
	queries: string[],
): string[] {
	const seen = new Set<string>();
	const normalized = [];

	for (const query of [originalQuery, ...queries]) {
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

async function generateAiAnswer(
	query: string,
	citations: CitationUnit[],
): Promise<GeneratedAnswer> {
	if (citations.length === 0) {
		return {
			answer: {
				status: "ready",
				segments: [
					{
						type: "text",
						text: "I could not find source-verified attestations for that query.",
					},
				],
			},
			traceStep: {
				stage: "answer-synthesis",
				status: "skipped",
				input: { query, citationCount: 0 },
				output: { reason: "No citations available." },
			},
		};
	}

	const evidence = citations.map((citation, index) => ({
		index: index + 1,
		citationHandle: citation.citationHandle,
		source: citation.source.title,
		location: `${citation.span.section}, ${citation.span.locator}`,
		quote: citation.attestation.anchorText,
		spanText: citation.span.text,
	}));
	const model = getOpenAIModel();
	let modelAnswer: z.infer<typeof aiAnswerSchema>;
	const startedAt = performance.now();

	try {
		modelAnswer = await chat({
			adapter: openaiText(model),
			outputSchema: aiAnswerSchema,
			systemPrompts: [
				[
					"You answer only from supplied evidence.",
					"Do not use outside knowledge.",
					"Every citation handle must be one of the provided citationHandle values.",
					"Return cited claims, not quote blocks.",
					"Do not copy the whole source quote into the answer unless the user asks for exact wording.",
					"If evidence is weak, say so in text and still cite the closest evidence.",
				].join(" "),
			],
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						query,
						evidence,
					}),
				},
			],
		});
	} catch (error) {
		const message =
			error instanceof Error
				? `AI answer failed: ${error.message}`
				: "AI answer failed.";
		const traceStep: AiTraceStep = {
			stage: "answer-synthesis",
			status: "failed",
			model,
			durationMs: elapsedMs(startedAt),
			input: {
				query,
				citationHandles: citations.map((citation) => citation.citationHandle),
			},
			error: message,
		};
		logTraceStep(traceStep);

		return {
			answer: {
				status: "unavailable",
				message,
			},
			traceStep,
		};
	}

	const modelSegments = selectModelSegments(modelAnswer.claims, citations);
	const evidencePreview = citations.map((citation, index) => ({
		index: index + 1,
		citationHandle: citation.citationHandle,
		source: citation.source.title,
		location: `${citation.span.section}, ${citation.span.locator}`,
		quote: truncateForTrace(citation.attestation.anchorText),
		spanText: truncateForTrace(citation.span.text),
	}));
	const traceStep: AiTraceStep = {
		stage: "answer-synthesis",
		status: "ready",
		model,
		durationMs: elapsedMs(startedAt),
		input: {
			query,
			citationHandles: citations.map((citation) => citation.citationHandle),
			evidencePreview,
		},
		output: {
			rawClaims: modelAnswer.claims,
			selectedSegments: modelSegments,
		},
	};
	logTraceStep(traceStep);

	return {
		answer: {
			status: "ready",
			segments: hydrateQuoteSegments(modelSegments, citations),
		},
		traceStep,
	};
}

async function rerankCitations(
	query: string,
	citations: CitationUnit[],
): Promise<RerankedCitations> {
	const model = getOpenAIModel();
	const startedAt = performance.now();
	const citationHandles = citations.map((citation) => citation.citationHandle);
	const evidencePreview = citations.map((citation, index) => ({
		index: index + 1,
		citationHandle: citation.citationHandle,
		source: citation.source.title,
		location: `${citation.span.section}, ${citation.span.locator}`,
		quote: truncateForTrace(citation.attestation.anchorText),
		spanText: truncateForTrace(citation.span.text),
		retrievalScore: citation.score,
	}));

	if (citations.length <= 6) {
		const traceStep: AiTraceStep = {
			stage: "rerank",
			status: "fallback",
			model,
			durationMs: elapsedMs(startedAt),
			input: {
				query,
				citationHandles,
				evidencePreview,
			},
			output: {
				reason: "Candidate set was already small enough for answer synthesis.",
				citationHandles,
			},
		};
		logTraceStep(traceStep);

		return {
			citations,
			traceStep,
		};
	}

	const evidence = citations.map((citation, index) => ({
		index: index + 1,
		citationHandle: citation.citationHandle,
		source: citation.source.title,
		location: `${citation.span.section}, ${citation.span.locator}`,
		quote: citation.attestation.anchorText,
		spanText: truncateForTrace(citation.span.text),
		retrievalScore: citation.score,
	}));

	try {
		const result = await chat({
			adapter: openaiText(model),
			outputSchema: rerankSchema,
			systemPrompts: [
				[
					"You rerank citation evidence for an answer generator.",
					"Select only citation handles that directly help answer the user query.",
					"Prefer narrow quotes over broad nearby context.",
					"Treat location or event wording like 'at the rabbit-hole' as a scope boundary, not permission to include all later events.",
					"Prefer evidence closest to the event named in the query over downstream consequences.",
					"Do not answer the query.",
					"Return at most 6 selected citation handles, ordered from strongest to weakest.",
				].join(" "),
			],
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						query,
						evidence,
					}),
				},
			],
		});
		const selected = normalizeRerankSelection({
			citations,
			query,
			selected: result.selected,
		});
		const traceStep: AiTraceStep = {
			stage: "rerank",
			status: "ready",
			model,
			durationMs: elapsedMs(startedAt),
			input: {
				query,
				citationHandles,
				evidencePreview,
			},
			output: {
				selected,
			},
		};
		logTraceStep(traceStep);

		return {
			citations: citationsByHandles(
				citations,
				selected.map((item) => item.citationHandle),
			),
			traceStep,
		};
	} catch (error) {
		const fallback = citations.slice(0, 6);
		const traceStep: AiTraceStep = {
			stage: "rerank",
			status: "fallback",
			model,
			durationMs: elapsedMs(startedAt),
			input: {
				query,
				citationHandles,
				evidencePreview,
			},
			output: {
				reason:
					error instanceof Error
						? `AI rerank failed: ${error.message}`
						: "AI rerank failed.",
				citationHandles: fallback.map((citation) => citation.citationHandle),
			},
		};
		logTraceStep(traceStep);

		return {
			citations: fallback,
			traceStep,
		};
	}
}

function normalizeRerankSelection({
	citations,
	query,
	selected,
}: {
	citations: CitationUnit[];
	query: string;
	selected: z.infer<typeof rerankSchema>["selected"];
}): Array<{
	citationHandle: string;
	relevance: number;
	rationale: string;
}> {
	const validHandles = new Set(
		citations.map((citation) => citation.citationHandle),
	);
	const seen = new Set<string>();
	const normalized = [];
	const directMatches = citations
		.map((citation) => ({
			citation,
			score: directQueryCitationScore(query, citation),
		}))
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, 2);

	for (const { citation, score } of directMatches) {
		seen.add(citation.citationHandle);
		normalized.push({
			citationHandle: citation.citationHandle,
			relevance: roundScore(Math.max(score, citation.score)),
			rationale: "Direct lexical match to the original user query.",
		});
	}

	for (const item of selected) {
		if (
			!validHandles.has(item.citationHandle) ||
			seen.has(item.citationHandle)
		) {
			continue;
		}

		seen.add(item.citationHandle);
		normalized.push({
			citationHandle: item.citationHandle,
			relevance: roundScore(item.relevance),
			rationale: item.rationale.trim().slice(0, 240),
		});
	}

	if (normalized.length > 0) {
		return normalized.slice(0, 6);
	}

	return citations.slice(0, 6).map((citation) => ({
		citationHandle: citation.citationHandle,
		relevance: citation.score,
		rationale:
			"Fallback to retrieval rank because the model selected no valid handles.",
	}));
}

function citationsByHandles(
	citations: CitationUnit[],
	handles: string[],
): CitationUnit[] {
	const byHandle = new Map(
		citations.map((citation) => [citation.citationHandle, citation]),
	);

	return handles.flatMap((handle) => {
		const citation = byHandle.get(handle);

		return citation ? [citation] : [];
	});
}

function directQueryCitationScore(
	query: string,
	citation: CitationUnit,
): number {
	const queryTokens = tokenize(query);

	if (queryTokens.length === 0) {
		return 0;
	}

	const anchorTokens = new Set(tokenize(citation.attestation.anchorText));
	let anchorOverlap = 0;

	for (const token of queryTokens) {
		if (anchorTokens.has(token)) {
			anchorOverlap += 1;
		}
	}

	return (
		anchorOverlap / queryTokens.length +
		claimCitationScore(query, citation) * 0.25
	);
}

function elapsedMs(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}

function getOpenAIModel(): OpenAIChatModel {
	const configuredModel = process.env.OPENAI_MODEL ?? "gpt-5.4-nano";

	if (isOpenAIChatModel(configuredModel)) {
		return configuredModel;
	}

	throw new Error(`OPENAI_MODEL is not supported: ${configuredModel}`);
}

function isOpenAIChatModel(model: string): model is OpenAIChatModel {
	return (OPENAI_CHAT_MODELS as readonly string[]).includes(model);
}

function logTraceStep(step: AiTraceStep) {
	console.info("[attestation-rag:ai]", JSON.stringify(step));
}

function truncateForTrace(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();

	return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function roundScore(score: number): number {
	return Math.round(score * 1000) / 1000;
}

function selectModelSegments(
	modelClaims: ModelClaim[],
	citations: CitationUnit[],
): ModelSegment[] {
	const fallback: ModelSegment[] = [
		{
			type: "text",
			text: "The available source-backed evidence says: ",
		},
		...citations.slice(0, 2).map((citation) => ({
			type: "citation" as const,
			citationHandle: citation.citationHandle,
		})),
	];

	const validHandles = new Set(
		citations.map((citation) => citation.citationHandle),
	);
	const segments = modelClaims.flatMap((claim): ModelSegment[] => {
		const text = claim.text.trim();
		const citationHandles = selectClaimCitationHandles({
			claimText: text,
			modelCitationHandles: claim.citationHandles.filter((citationHandle) =>
				validHandles.has(citationHandle),
			),
			citations,
		});

		if (!text || citationHandles.length === 0) {
			return [];
		}

		return [
			{ type: "text", text },
			...citationHandles.map((citationHandle) => ({
				type: "citation" as const,
				citationHandle,
			})),
			{ type: "text" as const, text: " " },
		];
	});

	return segments.length > 0 ? segments : fallback;
}

function selectClaimCitationHandles({
	citations,
	claimText,
	modelCitationHandles,
}: {
	citations: CitationUnit[];
	claimText: string;
	modelCitationHandles: string[];
}): string[] {
	const ranked = citations
		.map((citation) => ({
			citationHandle: citation.citationHandle,
			modelSelected: modelCitationHandles.includes(citation.citationHandle),
			score: claimCitationScore(claimText, citation),
		}))
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return Number(right.modelSelected) - Number(left.modelSelected);
		});
	const top = ranked.at(0);

	if (!top || top.score === 0) {
		return modelCitationHandles.slice(0, 2);
	}

	const selected = [top.citationHandle];

	for (const handle of modelCitationHandles) {
		if (selected.length >= 2) {
			break;
		}

		if (!selected.includes(handle)) {
			selected.push(handle);
		}
	}

	return selected;
}

function claimCitationScore(claimText: string, citation: CitationUnit): number {
	return tokenOverlap(
		claimText,
		[
			citation.attestation.anchorText,
			citation.span.text,
			citation.span.section,
			citation.source.title,
		].join(" "),
	);
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

function hydrateQuoteSegments(
	modelSegments: ModelSegment[],
	citations: CitationUnit[],
): AiAnswerSegment[] {
	const citationsByHandle = new Map(
		citations.map((citation, index) => [
			citation.citationHandle,
			{ citation, index },
		]),
	);

	return modelSegments.flatMap((segment): AiAnswerSegment[] => {
		if (segment.type === "text") {
			return [segment];
		}

		const match = citationsByHandle.get(segment.citationHandle);

		if (!match) {
			return [];
		}

		const { citation, index } = match;

		return [
			{
				type: "citation",
				citationHandle: citation.citationHandle,
				citationNumber: index + 1,
				text: segment.text,
				quote: citation.attestation.anchorText,
				sourceTitle: citation.source.title,
				section: citation.span.section,
				locator: citation.span.locator,
				sourceText: citation.span.text,
			},
		];
	});
}

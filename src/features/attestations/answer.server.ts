import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
import {
	claimsSafeForAnswerSegments,
	verifyAnswerClaims,
} from "./claim-verification";
import { tokenize } from "./embed";
import { getOpenAiUnavailableReason, serverEnv } from "./env.server";
import { tryRecordQueryRun } from "./history.server";
import { searchCorpusWithQueries } from "./search.server";
import type {
	AiAnswer,
	AiAnswerSegment,
	AiTraceStep,
	AiTraceTiming,
	AiTraceTimingSpan,
	CitationUnit,
	QueryMode,
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

type AgenticRetrievalPlan = {
	exactPhrases: string[];
	searchQueries: string[];
	rationale: string;
	error?: string;
	traceStep: AiTraceStep;
};

type GeneratedAnswer = {
	answer: AiAnswer;
	traceSteps: AiTraceStep[];
};

type RerankedCitations = {
	citations: CitationUnit[];
	traceStep: AiTraceStep;
};

const retrievalPlanSchema = z.object({
	queries: z.array(z.string()).min(1).max(5),
});

const agenticRetrievalPlanSchema = z.object({
	exactPhrases: z.array(z.string()).max(6),
	searchQueries: z.array(z.string()).min(1).max(5),
	rationale: z.string(),
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

export async function answerCorpus(
	query: string,
	queryMode: QueryMode = "hybrid",
): Promise<SearchResponse> {
	const startedAt = performance.now();
	const traceSteps: AiTraceStep[] = [];
	const openAiUnavailableReason = getOpenAiUnavailableReason();

	if (openAiUnavailableReason) {
		const search = await searchCorpusWithQueries({
			query,
			queryMode,
			retrievalQueries: [query],
		});
		if (search.aiTrace) {
			traceSteps.push(...search.aiTrace.steps);
		}
		traceSteps.push({
			stage: "config",
			status: "skipped",
			error: openAiUnavailableReason,
		});

		const response = {
			...search,
			aiTrace: buildAiTrace(traceSteps, startedAt),
			aiAnswer: {
				status: "unavailable",
				message: openAiUnavailableReason,
			},
		} satisfies SearchResponse;
		tryRecordQueryRun(response);

		return response;
	}

	const retrievalPlan =
		queryMode === "agentic"
			? await generateAgenticRetrievalPlan(query)
			: await generateRetrievalPlan(query);
	traceSteps.push(retrievalPlan.traceStep);
	const search = await searchCorpusWithQueries({
		query,
		queryMode,
		retrievalQueries:
			queryMode === "agentic"
				? retrievalPlan.searchQueries
				: retrievalPlan.queries,
		exactPhrases:
			queryMode === "agentic" ? retrievalPlan.exactPhrases : undefined,
		chunkLimit: 40,
		citationLimit: 30,
		citationScoreFloor: 0,
	});
	if (search.aiTrace) {
		traceSteps.push(...search.aiTrace.steps);
	}

	if (retrievalPlan.error) {
		const response = {
			...search,
			aiTrace: buildAiTrace(traceSteps, startedAt),
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
	traceSteps.push(...generatedAnswer.traceSteps);

	const response = {
		...search,
		citations: reranked.citations,
		aiTrace: buildAiTrace(traceSteps, startedAt),
		aiAnswer: generatedAnswer.answer,
	};
	tryRecordQueryRun(response);

	return response;
}

async function generateRetrievalPlan(query: string): Promise<RetrievalPlan> {
	const model = serverEnv.openAi.model;
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

async function generateAgenticRetrievalPlan(
	query: string,
): Promise<AgenticRetrievalPlan> {
	const model = serverEnv.openAi.model;
	const startedAt = performance.now();
	const fallback = {
		exactPhrases: extractQuotedPhrases(query),
		searchQueries: [query],
		rationale: "Fallback to the user query because agentic planning failed.",
	};

	try {
		const plan = await chat({
			adapter: openaiText(model),
			outputSchema: agenticRetrievalPlanSchema,
			systemPrompts: [
				[
					"You plan a bounded corpus search.",
					"Do not answer the question.",
					"Prefer exact phrase probes for named phrases, quoted terms, titles, objects, and unusual wording.",
					"Use search queries only for semantic context after exact phrase probes.",
					"Avoid broad thematic expansions unless the user asks for themes.",
					"Return at most 6 exact phrases and 3 to 5 search queries.",
				].join(" "),
			],
			messages: [
				{
					role: "user",
					content: query,
				},
			],
		});
		const output = normalizeAgenticPlan(query, plan);
		const traceStep: AiTraceStep = {
			stage: "agentic-retrieval",
			status: "ready",
			model,
			durationMs: elapsedMs(startedAt),
			input: { query },
			output,
		};
		logTraceStep(traceStep);

		return {
			...output,
			traceStep,
		};
	} catch (error) {
		const output = normalizeAgenticPlan(query, fallback);
		const message =
			error instanceof Error
				? `Agentic retrieval planning failed: ${error.message}`
				: "Agentic retrieval planning failed.";
		const traceStep: AiTraceStep = {
			stage: "agentic-retrieval",
			status: "failed",
			model,
			durationMs: elapsedMs(startedAt),
			input: { query },
			error: message,
			output,
		};
		logTraceStep(traceStep);

		return {
			...output,
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

function normalizeAgenticPlan(
	originalQuery: string,
	plan: {
		exactPhrases: string[];
		searchQueries: string[];
		rationale: string;
	},
): {
	exactPhrases: string[];
	searchQueries: string[];
	rationale: string;
} {
	return {
		exactPhrases: normalizeExactPhrases([
			...extractQuotedPhrases(originalQuery),
			...plan.exactPhrases,
		]),
		searchQueries: normalizePlanQueries(originalQuery, plan.searchQueries),
		rationale: plan.rationale.replace(/\s+/g, " ").trim().slice(0, 500),
	};
}

function normalizeExactPhrases(phrases: string[]): string[] {
	const seen = new Set<string>();
	const normalized = [];

	for (const phrase of phrases) {
		const compact = phrase.replace(/\s+/g, " ").trim();
		const key = compact.toLowerCase();

		if (compact.length < 3 || seen.has(key)) {
			continue;
		}

		seen.add(key);
		normalized.push(compact.slice(0, 120));
	}

	return normalized.slice(0, 6);
}

function extractQuotedPhrases(query: string): string[] {
	return [...query.matchAll(/["“”']([^"“”']{3,120})["“”']/g)].map((match) =>
		(match[1] ?? "").trim(),
	);
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
			traceSteps: [
				{
					stage: "answer-synthesis",
					status: "skipped",
					input: { query, citationCount: 0 },
					output: { reason: "No citations available." },
				},
			],
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
	const model = serverEnv.openAi.model;
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
			traceSteps: [traceStep],
		};
	}

	const verifiedClaims = await verifyAnswerClaims({
		claims: modelAnswer.claims,
		citations,
	});
	const safeClaims = claimsSafeForAnswerSegments(verifiedClaims);
	const modelSegments =
		safeClaims.length > 0
			? selectModelSegments(safeClaims, citations)
			: [
					{
						type: "text" as const,
						text: "I could not verify the generated claims against the cited source evidence.",
					},
				];
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
	const claimVerificationTraceStep: AiTraceStep = {
		stage: "claim-verification",
		status: "ready",
		input: {
			claimCount: modelAnswer.claims.length,
			citationHandles: citations.map((citation) => citation.citationHandle),
		},
		output: {
			claims: verifiedClaims,
		},
	};
	logTraceStep(traceStep);
	logTraceStep(claimVerificationTraceStep);

	return {
		answer: {
			status: "ready",
			segments: hydrateQuoteSegments(modelSegments, citations),
			claims: verifiedClaims,
		},
		traceSteps: [traceStep, claimVerificationTraceStep],
	};
}

async function rerankCitations(
	query: string,
	citations: CitationUnit[],
): Promise<RerankedCitations> {
	const model = serverEnv.openAi.model;
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

		const citationsByHandle = new Map(
			citations.map((citation) => [citation.citationHandle, citation]),
		);

		return {
			citations: selected.flatMap((item) => {
				const citation = citationsByHandle.get(item.citationHandle);

				return citation ? [citation] : [];
			}),
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

function buildAiTrace(
	steps: AiTraceStep[],
	startedAt: number,
): { steps: AiTraceStep[]; timing: AiTraceTiming } {
	const totalMs = elapsedMs(startedAt);
	const spans = steps.flatMap(traceStepTimingSpans);
	const modelProviderMs = spans
		.filter((span) => span.category === "model-provider")
		.reduce((total, span) => total + span.durationMs, 0);

	return {
		steps,
		timing: {
			totalMs,
			modelProviderMs,
			applicationMs: Math.max(0, totalMs - modelProviderMs),
			spans,
		},
	};
}

function traceStepTimingSpans(step: AiTraceStep): AiTraceTimingSpan[] {
	if (step.stage === "retrieval") {
		return step.output.timing;
	}

	if ("durationMs" in step && "model" in step) {
		return [
			{
				stage: step.stage,
				label: step.stage,
				category: "model-provider",
				durationMs: step.durationMs,
				model: step.model,
			},
		];
	}

	return [];
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
		const citationHandles = claim.citationHandles.filter((citationHandle) =>
			validHandles.has(citationHandle),
		);

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

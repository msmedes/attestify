import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
import { loadServerEnv } from "./env.server";
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

const retrievalPlanSchema = z.object({
	queries: z.array(z.string()).min(1).max(5),
});

const aiAnswerSchema = z.object({
	segments: z
		.array(
			z.object({
				type: z.enum(["text", "quote"]),
				text: z.string().optional(),
				citationHandle: z.string().optional(),
			}),
		)
		.min(1),
});

export async function answerCorpus(query: string): Promise<SearchResponse> {
	loadServerEnv();
	const traceSteps: AiTraceStep[] = [];

	if (!process.env.OPENAI_API_KEY) {
		const search = await searchCorpusWithQueries({
			query,
			retrievalQueries: [query],
		});
		traceSteps.push({
			stage: "config",
			status: "skipped",
			error: "OPENAI_API_KEY is not configured.",
		});

		return {
			...search,
			aiTrace: { steps: traceSteps },
			aiAnswer: {
				status: "unavailable",
				message: "OPENAI_API_KEY is not configured for the AI answer route.",
			},
		};
	}

	const retrievalPlan = await generateRetrievalPlan(query);
	traceSteps.push(retrievalPlan.traceStep);
	const search = await searchCorpusWithQueries({
		query,
		retrievalQueries: retrievalPlan.queries,
	});
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
		return {
			...search,
			aiTrace: { steps: traceSteps },
			aiAnswer: {
				status: "unavailable",
				message: retrievalPlan.error,
			},
		};
	}

	const generatedAnswer = await generateAiAnswer(query, search.citations);
	traceSteps.push(generatedAnswer.traceStep);

	return {
		...search,
		aiTrace: { steps: traceSteps },
		aiAnswer: generatedAnswer.answer,
	};
}

async function generateRetrievalPlan(query: string): Promise<RetrievalPlan> {
	const model = process.env.OPENAI_MODEL || "gpt-4.1-nano";
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
	const model = process.env.OPENAI_MODEL || "gpt-4.1-nano";
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
					"Every quote segment must use one of the provided citationHandle values.",
					"For cited claims, return a text segment with the answer prose and citationHandle.",
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

	const modelSegments = selectModelSegments(modelAnswer.segments, citations);
	const traceStep: AiTraceStep = {
		stage: "answer-synthesis",
		status: "ready",
		model,
		durationMs: elapsedMs(startedAt),
		input: {
			query,
			citationHandles: citations.map((citation) => citation.citationHandle),
		},
		output: {
			rawSegments: modelAnswer.segments,
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

function elapsedMs(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}

function logTraceStep(step: AiTraceStep) {
	console.info("[attestation-rag:ai]", JSON.stringify(step));
}

function selectModelSegments(
	modelSegments: z.infer<typeof aiAnswerSchema>["segments"],
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
	const segments = modelSegments.flatMap((segment): ModelSegment[] => {
		if (segment.type === "text" && segment.text?.trim()) {
			const textSegment: ModelSegment = { type: "text", text: segment.text };

			if (segment.citationHandle && validHandles.has(segment.citationHandle)) {
				return [
					textSegment,
					{
						type: "citation",
						citationHandle: segment.citationHandle,
					},
				];
			}

			return [textSegment];
		}

		if (
			segment.type === "quote" &&
			segment.citationHandle &&
			validHandles.has(segment.citationHandle)
		) {
			return [
				{
					type: "citation",
					text: segment.text?.trim() ? segment.text : undefined,
					citationHandle: segment.citationHandle,
				},
			];
		}

		return [];
	});

	return segments.length > 0 ? segments : fallback;
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

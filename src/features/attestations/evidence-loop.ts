import { type ChatMiddleware, chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";
import type {
	AiTraceStep,
	CitationUnit,
	EvidenceLoopStopReason,
	EvidenceLoopTraceStep,
	RetrievalChunk,
	SearchResponse,
} from "./types";

const DEFAULT_BUDGETS = {
	maxIterations: 4,
	maxModelCalls: 4,
	maxExtractionCalls: 2,
	maxRetrievedSpans: 80,
	maxInspectedSpans: 8,
	maxElapsedMs: 30_000,
};

const searchActionSchema = z.object({
	type: z.literal("search"),
	queries: z.array(z.string()).min(1).max(5),
	exactPhrases: z.array(z.string()).max(6).optional(),
});

const stopActionSchema = z.object({
	type: z.literal("stop"),
	reason: z.enum(["enough-evidence", "insufficient-evidence"]),
});

const inspectActionSchema = z.object({
	type: z.literal("inspect"),
	spanIds: z.array(z.string()).min(1).max(5),
});

const extractActionSchema = z.object({
	type: z.literal("extract"),
	spanIds: z.array(z.string()).min(1).max(3),
});
const finishEvidenceActionSchema = z.object({
	reason: z.enum(["enough-evidence", "insufficient-evidence"]),
});

const autonomousEvidenceResultSchema = z.object({
	stopReason: z.enum(["enough-evidence", "insufficient-evidence"]),
	rationale: z.string().optional(),
});

export const evidenceActionSchema = z.discriminatedUnion("type", [
	searchActionSchema,
	extractActionSchema,
	inspectActionSchema,
	stopActionSchema,
]);

export type EvidenceAction = z.infer<typeof evidenceActionSchema>;

export const evidencePlannerOutputSchema = z.object({
	action: z.union([
		searchActionSchema,
		extractActionSchema,
		inspectActionSchema,
		stopActionSchema,
	]),
});

export type EvidenceLoopBudgets = typeof DEFAULT_BUDGETS;

export type EvidenceLoopPlannerInput = {
	query: string;
	iteration: number;
	previousActions: EvidenceLoopTraceStep["output"]["iterations"];
	citations: CitationUnit[];
	inspectedSpans: InspectedEvidenceSpan[];
	retrievalChunks: RetrievalChunk[];
	budgetUsage: EvidenceLoopTraceStep["output"]["budgetUsage"];
};

export type EvidenceLoopPlanner = (
	input: EvidenceLoopPlannerInput,
) => Promise<unknown>;

export type EvidenceLoopTools = {
	extract: (input: {
		search: SearchResponse;
		spanIds: string[];
	}) => Promise<ExtractionEvidenceResult>;
	inspect: (input: { spanIds: string[] }) => Promise<InspectedEvidenceSpan[]>;
	search: (input: {
		query: string;
		queries: string[];
		exactPhrases: string[];
	}) => Promise<SearchResponse>;
};

export type ExtractionEvidenceResult = {
	attempts: Array<{
		spanId: string;
		cacheHit: boolean;
		rawCandidates: number;
		verifiedCandidates: number;
		promotions: number;
		rejections: number;
	}>;
	citations: CitationUnit[];
	promotedAttestationIds: string[];
	rejectedCandidateCount: number;
	verifiedCandidateCount: number;
};

export type InspectedEvidenceSpan = {
	spanId: string;
	sourceId: string;
	title: string;
	section: string;
	locator: string;
	text: string;
};

export type EvidenceLoopResult = {
	search: SearchResponse | null;
	traceStep: EvidenceLoopTraceStep;
	searchTraceSteps: AiTraceStep[];
};

export async function runAutonomousEvidenceLoop({
	budgets = DEFAULT_BUDGETS,
	model,
	query,
	tools,
}: {
	budgets?: EvidenceLoopBudgets;
	model: string;
	query: string;
	tools: EvidenceLoopTools;
}): Promise<EvidenceLoopResult> {
	const startedAt = performance.now();
	const iterations: EvidenceLoopTraceStep["output"]["iterations"] = [];
	const searchTraceSteps: AiTraceStep[] = [];
	let search: SearchResponse | null = null;
	let stopReason: EvidenceLoopStopReason | null = null;
	let extractionCalls = 0;
	let modelCalls = 0;
	let retrievedSpans = 0;
	const inspectedSpans = new Map<string, InspectedEvidenceSpan>();
	const hasCitations = () => (search?.citations.length ?? 0) > 0;
	const canFinishWithEnoughEvidence = () => search !== null && hasCitations();

	const budgetUsage = () =>
		currentBudgetUsage({
			startedAt,
			extractionCalls,
			inspectedSpans: inspectedSpans.size,
			iterations: iterations.length,
			modelCalls,
			retrievedSpans,
		});
	const rejectAction = ({
		action,
		iteration,
		reason,
		reasonCode = "invalid-action",
	}: {
		action: EvidenceAction;
		iteration: number;
		reason: string;
		reasonCode?: EvidenceLoopStopReason;
	}) => {
		stopReason = reasonCode;
		iterations.push({
			iteration,
			requestedAction: action,
			validatedAction: traceAction(action),
			rejectedAction: { reason },
		});

		return { error: reason };
	};
	const nextIteration = () => iterations.length + 1;
	const recordResult = ({
		action,
		iteration,
		resultSummary,
	}: {
		action: EvidenceAction;
		iteration: number;
		resultSummary?: EvidenceLoopTraceStep["output"]["iterations"][number]["resultSummary"];
	}) => {
		iterations.push({
			iteration,
			requestedAction: action,
			validatedAction: traceAction(action),
			...(resultSummary ? { resultSummary } : {}),
		});
	};
	const validateAction = (action: EvidenceAction, iteration: number) => {
		const normalized = normalizeEvidenceAction(action);

		if (iteration > budgets.maxIterations) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: "Evidence-loop action exceeded iteration budget.",
				reasonCode: "budget-exhausted",
			});
		}
		if (normalized.type === "search" && normalized.queries.length === 0) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: "Search action contained no non-empty queries.",
			});
		}
		if (normalized.type === "inspect" && normalized.spanIds.length === 0) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: "Inspect action contained no non-empty span IDs.",
			});
		}
		if (normalized.type === "extract" && normalized.spanIds.length === 0) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: "Extract action contained no non-empty span IDs.",
			});
		}
		if (
			(normalized.type === "inspect" || normalized.type === "extract") &&
			!spanIdsAreAvailable({
				action: normalized,
				inspectedSpans,
				search,
			})
		) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: `${normalized.type === "extract" ? "Extract" : "Inspect"} action referenced unavailable span IDs.`,
			});
		}
		if (normalized.type === "extract" && !search) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: "Extract action requires retrieved evidence.",
			});
		}
		if (normalized.type === "inspect") {
			const repeatedSpanIds = normalized.spanIds.filter((spanId) =>
				inspectedSpans.has(spanId),
			);

			if (repeatedSpanIds.length > 0) {
				return rejectAction({
					action: normalized,
					iteration,
					reason: `Inspect action repeated already inspected span IDs: ${repeatedSpanIds.join(", ")}.`,
				});
			}
		}
		if (isRepeatedAction(normalized, iterations)) {
			return rejectAction({
				action: normalized,
				iteration,
				reason: "Repeated evidence action.",
			});
		}

		return normalized;
	};

	const searchEvidence = toolDefinition({
		name: "searchEvidence",
		description:
			"Search the local source corpus for evidence. Use 3 to 5 literal retrieval queries and optional exact phrases for names, titles, quoted terms, and unusual wording. This is not web search; do not use URLs, site: operators, or search-engine syntax.",
		inputSchema: searchActionSchema.omit({ type: true }),
	}).server(async ({ queries, exactPhrases }) => {
		const iteration = nextIteration();
		const action = validateAction(
			{ type: "search", queries, exactPhrases },
			iteration,
		);
		if ("error" in action) {
			return action;
		}

		try {
			search = await tools.search({
				query,
				queries: action.queries,
				exactPhrases: action.exactPhrases ?? [],
			});
		} catch (error) {
			return rejectAction({
				action,
				iteration,
				reason:
					error instanceof Error
						? `Search failed: ${error.message}`
						: "Search failed.",
				reasonCode: "tool-error",
			});
		}

		if (search.aiTrace) {
			searchTraceSteps.push(...search.aiTrace.steps);
		}
		retrievedSpans += search.retrievalChunks.length;
		recordResult({
			action,
			iteration,
			resultSummary: {
				chunks: search.retrievalChunks.length,
				citations: search.citations.length,
				citationHandles: search.citations.map(
					(citation) => citation.citationHandle,
				),
			},
		});
		if (isBudgetExhausted(budgetUsage(), budgets)) {
			stopReason = "budget-exhausted";
		}

		return {
			chunks: search.retrievalChunks.slice(0, 8).map((chunk) => ({
				spanId: chunk.spanId,
				sourceId: chunk.sourceId,
				title: chunk.title,
				location: `${chunk.section}, ${chunk.locator}`,
				text: truncateForTrace(chunk.text),
			})),
			citationHandles: search.citations
				.slice(0, 12)
				.map((citation) => citation.citationHandle),
			citationCount: search.citations.length,
		};
	});

	const inspectSpans = toolDefinition({
		name: "inspectSpans",
		description:
			"Read full source text for already retrieved span IDs when more context would help decide the next evidence step.",
		inputSchema: inspectActionSchema.omit({ type: true }),
	}).server(async ({ spanIds }) => {
		const iteration = nextIteration();
		const action = validateAction({ type: "inspect", spanIds }, iteration);
		if ("error" in action) {
			return action;
		}
		const inspectBudgetUsage = currentBudgetUsage({
			startedAt,
			extractionCalls,
			inspectedSpans: inspectedSpans.size + action.spanIds.length,
			iterations: iteration,
			modelCalls,
			retrievedSpans,
		});
		if (isBudgetExhausted(inspectBudgetUsage, budgets)) {
			return rejectAction({
				action,
				iteration,
				reason: "Inspect action exceeded evidence-loop budget.",
				reasonCode: "budget-exhausted",
			});
		}

		try {
			const inspected = await tools.inspect({ spanIds: action.spanIds });
			for (const span of inspected) {
				inspectedSpans.set(span.spanId, span);
			}
			recordResult({
				action,
				iteration,
				resultSummary: {
					chunks: search?.retrievalChunks.length ?? 0,
					citations: search?.citations.length ?? 0,
					citationHandles:
						search?.citations.map((citation) => citation.citationHandle) ?? [],
					inspectedSpans: inspected.map((span) => ({
						spanId: span.spanId,
						sourceId: span.sourceId,
						title: span.title,
						section: span.section,
						locator: span.locator,
					})),
				},
			});

			return {
				spans: inspected.map((span) => ({
					spanId: span.spanId,
					sourceId: span.sourceId,
					title: span.title,
					location: `${span.section}, ${span.locator}`,
					text: truncateForTrace(span.text),
				})),
			};
		} catch (error) {
			return rejectAction({
				action,
				iteration,
				reason:
					error instanceof Error
						? `Inspection failed: ${error.message}`
						: "Inspection failed.",
				reasonCode: "tool-error",
			});
		}
	});

	const extractAttestations = toolDefinition({
		name: "extractAttestations",
		description:
			"Run host-verified lazy extraction on retrieved or inspected span IDs when stronger citation candidates are needed.",
		inputSchema: extractActionSchema.omit({ type: true }),
	}).server(async ({ spanIds }) => {
		const iteration = nextIteration();
		const action = validateAction({ type: "extract", spanIds }, iteration);
		if ("error" in action) {
			return action;
		}
		const extractBudgetUsage = currentBudgetUsage({
			startedAt,
			extractionCalls: extractionCalls + action.spanIds.length,
			inspectedSpans: inspectedSpans.size,
			iterations: iteration,
			modelCalls,
			retrievedSpans,
		});
		if (isBudgetExhausted(extractBudgetUsage, budgets)) {
			return rejectAction({
				action,
				iteration,
				reason: "Extract action exceeded evidence-loop budget.",
				reasonCode: "budget-exhausted",
			});
		}

		try {
			const extraction = await tools.extract({
				search: search as SearchResponse,
				spanIds: action.spanIds,
			});
			extractionCalls += action.spanIds.length;
			search = {
				...(search as SearchResponse),
				citations: extraction.citations,
			};
			recordResult({
				action,
				iteration,
				resultSummary: {
					chunks: search.retrievalChunks.length,
					citations: search.citations.length,
					citationHandles: search.citations.map(
						(citation) => citation.citationHandle,
					),
					extraction: {
						attemptedSpanIds: action.spanIds,
						promotedAttestationIds: extraction.promotedAttestationIds,
						rejectedCandidateCount: extraction.rejectedCandidateCount,
						verifiedCandidateCount: extraction.verifiedCandidateCount,
					},
				},
			});

			return {
				citationHandles: search.citations
					.slice(0, 12)
					.map((citation) => citation.citationHandle),
				promotedAttestationIds: extraction.promotedAttestationIds,
				rejectedCandidateCount: extraction.rejectedCandidateCount,
				verifiedCandidateCount: extraction.verifiedCandidateCount,
			};
		} catch (error) {
			return rejectAction({
				action,
				iteration,
				reason:
					error instanceof Error
						? `Extraction failed: ${error.message}`
						: "Extraction failed.",
				reasonCode: "tool-error",
			});
		}
	});

	const finishEvidence = toolDefinition({
		name: "finishEvidence",
		description:
			"Finish evidence gathering once citations are enough to answer from source evidence, or when more searches are unlikely to help.",
		inputSchema: finishEvidenceActionSchema,
	}).server(({ reason }) => {
		const iteration = nextIteration();
		const action = { type: "stop" as const, reason };
		if (reason === "enough-evidence" && !canFinishWithEnoughEvidence()) {
			return rejectAction({
				action,
				iteration,
				reason:
					"Cannot finish with enough evidence before host-verified citations exist.",
			});
		}
		stopReason = reason;
		recordResult({ action, iteration });

		return {
			stopReason: reason,
			citationCount: search?.citations.length ?? 0,
		};
	});

	const middleware: ChatMiddleware = {
		name: "attestify-evidence-loop",
		onIteration(_ctx, info) {
			modelCalls = Math.max(modelCalls, info.iteration + 1);
		},
	};
	const agentLoopModelCallBudget = Math.max(0, budgets.maxModelCalls - 1);

	try {
		const result = await chat({
			adapter: openaiText(model),
			agentLoopStrategy: ({ iterationCount }) =>
				!stopReason &&
				iterations.length < budgets.maxIterations &&
				iterationCount < agentLoopModelCallBudget &&
				!isBudgetExhausted(budgetUsage(), budgets),
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						query,
					}),
				},
			],
			middleware: [middleware],
			modelOptions: {
				max_tool_calls: budgets.maxModelCalls,
				parallel_tool_calls: false,
				tool_choice: "auto",
			},
			outputSchema: autonomousEvidenceResultSchema,
			systemPrompts: [
				[
					"You autonomously gather source evidence before answer synthesis.",
					"Do not answer the user question.",
					"Use searchEvidence first with 3 to 5 literal source-retrieval queries for the local corpus.",
					"Do not use web-search syntax, URLs, or site: operators; searchEvidence is not connected to the web.",
					"Use inspectSpans only for promising retrieved span IDs when full text would help.",
					"Use extractAttestations only for retrieved or inspected span IDs where host-verified promotion could improve citations.",
					"Use finishEvidence with enough-evidence once citations are enough to answer from source evidence.",
					"Use finishEvidence with insufficient-evidence if further search is unlikely to help.",
					"Never invent citation handles or span IDs.",
				].join(" "),
			],
			tools: [
				searchEvidence,
				inspectSpans,
				extractAttestations,
				finishEvidence,
			],
		});
		modelCalls += 1;
		stopReason ??=
			result.stopReason === "enough-evidence" && !canFinishWithEnoughEvidence()
				? "insufficient-evidence"
				: result.stopReason;
	} catch (error) {
		stopReason = "model-unavailable";
		iterations.push({
			iteration: nextIteration(),
			requestedAction: null,
			rejectedAction: {
				reason:
					error instanceof Error
						? `Agent failed: ${error.message}`
						: "Agent failed.",
			},
		});
	}

	const finalBudgetUsage = budgetUsage();
	const exceededModelCallBudget =
		finalBudgetUsage.modelCalls > budgets.maxModelCalls;
	const finalStopReason = exceededModelCallBudget
		? "budget-exhausted"
		: (stopReason ??
			(finalBudgetUsage.iterations >= budgets.maxIterations ||
			finalBudgetUsage.modelCalls >= budgets.maxModelCalls ||
			isBudgetExhausted(finalBudgetUsage, budgets)
				? "budget-exhausted"
				: "insufficient-evidence"));

	return {
		search,
		searchTraceSteps,
		traceStep: {
			stage: "evidence-loop",
			status: finalStopReason === "enough-evidence" ? "ready" : "stopped",
			model,
			durationMs: finalBudgetUsage.elapsedMs,
			input: {
				query,
				budgets,
			},
			output: {
				stopReason: finalStopReason,
				budgetUsage: finalBudgetUsage,
				iterations,
				consideredEvidence: [...inspectedSpans.values()].map((span) => ({
					spanId: span.spanId,
					sourceId: span.sourceId,
					title: span.title,
					section: span.section,
					locator: span.locator,
					textPreview: truncateForTrace(span.text),
				})),
			},
		},
	};
}

export async function runEvidenceLoop({
	budgets = DEFAULT_BUDGETS,
	model,
	planner,
	query,
	tools,
}: {
	budgets?: EvidenceLoopBudgets;
	model?: string;
	planner: EvidenceLoopPlanner;
	query: string;
	tools: EvidenceLoopTools;
}): Promise<EvidenceLoopResult> {
	const startedAt = performance.now();
	const iterations: EvidenceLoopTraceStep["output"]["iterations"] = [];
	const searchTraceSteps: AiTraceStep[] = [];
	let search: SearchResponse | null = null;
	let stopReason: EvidenceLoopStopReason | null = null;
	let extractionCalls = 0;
	let modelCalls = 0;
	let retrievedSpans = 0;
	const inspectedSpans = new Map<string, InspectedEvidenceSpan>();

	for (let iteration = 1; iteration <= budgets.maxIterations; iteration += 1) {
		const budgetUsage = currentBudgetUsage({
			startedAt,
			extractionCalls,
			inspectedSpans: inspectedSpans.size,
			iterations: iteration - 1,
			modelCalls,
			retrievedSpans,
		});

		if (
			budgetUsage.modelCalls >= budgets.maxModelCalls ||
			isBudgetExhausted(budgetUsage, budgets)
		) {
			stopReason = "budget-exhausted";
			break;
		}

		let requestedAction: unknown;
		try {
			modelCalls += 1;
			requestedAction = await planner({
				query,
				iteration,
				previousActions: iterations,
				citations: search?.citations ?? [],
				inspectedSpans: [...inspectedSpans.values()],
				retrievalChunks: search?.retrievalChunks ?? [],
				budgetUsage,
			});
		} catch (error) {
			stopReason = "model-unavailable";
			iterations.push({
				iteration,
				requestedAction: null,
				rejectedAction: {
					reason:
						error instanceof Error
							? `Planner failed: ${error.message}`
							: "Planner failed.",
				},
			});
			break;
		}

		const parsedAction = evidenceActionSchema.safeParse(
			compactPlannerAction(requestedAction),
		);
		if (!parsedAction.success) {
			stopReason = "invalid-action";
			iterations.push({
				iteration,
				requestedAction,
				rejectedAction: {
					reason: z.prettifyError(parsedAction.error),
				},
			});
			break;
		}

		if (
			isBudgetExhausted(
				currentBudgetUsage({
					startedAt,
					extractionCalls,
					inspectedSpans: inspectedSpans.size,
					iterations: iteration - 1,
					modelCalls,
					retrievedSpans,
				}),
				budgets,
			)
		) {
			stopReason = "budget-exhausted";
			iterations.push({
				iteration,
				requestedAction,
				rejectedAction: {
					reason: "Budget exhausted before action could run.",
				},
			});
			break;
		}

		const action = normalizeEvidenceAction(parsedAction.data);
		if (action.type === "search" && action.queries.length === 0) {
			stopReason = "invalid-action";
			iterations.push({
				iteration,
				requestedAction,
				rejectedAction: {
					reason: "Search action contained no non-empty queries.",
				},
			});
			break;
		}
		if (action.type === "extract" && action.spanIds.length === 0) {
			stopReason = "invalid-action";
			iterations.push({
				iteration,
				requestedAction,
				rejectedAction: {
					reason: "Extract action contained no non-empty span IDs.",
				},
			});
			break;
		}
		if (action.type === "inspect" && action.spanIds.length === 0) {
			stopReason = "invalid-action";
			iterations.push({
				iteration,
				requestedAction,
				rejectedAction: {
					reason: "Inspect action contained no non-empty span IDs.",
				},
			});
			break;
		}
		if (action.type === "inspect" || action.type === "extract") {
			const availableSpanIds = new Set([
				...(search?.retrievalChunks.map((chunk) => chunk.spanId) ?? []),
				...inspectedSpans.keys(),
			]);
			const unknownSpanIds = action.spanIds.filter(
				(spanId) => !availableSpanIds.has(spanId),
			);

			if (action.type === "inspect") {
				const repeatedSpanIds = action.spanIds.filter((spanId) =>
					inspectedSpans.has(spanId),
				);

				if (repeatedSpanIds.length > 0) {
					stopReason = "invalid-action";
					iterations.push({
						iteration,
						requestedAction,
						validatedAction: traceAction(action),
						rejectedAction: {
							reason: `Inspect action repeated already inspected span IDs: ${repeatedSpanIds.join(", ")}.`,
						},
					});
					break;
				}
			}

			if (action.type === "extract" && !search) {
				stopReason = "invalid-action";
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					rejectedAction: {
						reason: "Extract action requires retrieved evidence.",
					},
				});
				break;
			}

			if (unknownSpanIds.length > 0) {
				stopReason = "invalid-action";
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					rejectedAction: {
						reason: `${action.type === "extract" ? "Extract" : "Inspect"} action referenced unavailable span IDs: ${unknownSpanIds.join(", ")}.`,
					},
				});
				break;
			}
		}
		if (isRepeatedAction(action, iterations)) {
			stopReason = "invalid-action";
			iterations.push({
				iteration,
				requestedAction,
				validatedAction: traceAction(action),
				rejectedAction: {
					reason: "Repeated evidence action.",
				},
			});
			break;
		}

		if (action.type === "stop") {
			const currentUsage = currentBudgetUsage({
				startedAt,
				extractionCalls,
				inspectedSpans: inspectedSpans.size,
				iterations: iteration,
				modelCalls,
				retrievedSpans,
			});
			stopReason = isBudgetExhausted(currentUsage, budgets)
				? "budget-exhausted"
				: action.reason;
			iterations.push({
				iteration,
				requestedAction,
				validatedAction: traceAction(action),
			});
			break;
		}

		if (action.type === "extract") {
			const extractBudgetUsage = currentBudgetUsage({
				startedAt,
				extractionCalls: extractionCalls + action.spanIds.length,
				inspectedSpans: inspectedSpans.size,
				iterations: iteration,
				modelCalls,
				retrievedSpans,
			});
			if (isBudgetExhausted(extractBudgetUsage, budgets)) {
				stopReason = "budget-exhausted";
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					rejectedAction: {
						reason: "Extract action exceeded evidence-loop budget.",
					},
				});
				break;
			}

			try {
				const extraction = await tools.extract({
					search: search as SearchResponse,
					spanIds: action.spanIds,
				});
				extractionCalls += action.spanIds.length;
				search = {
					...(search as SearchResponse),
					citations: extraction.citations,
				};
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					resultSummary: {
						chunks: search.retrievalChunks.length,
						citations: search.citations.length,
						citationHandles: search.citations.map(
							(citation) => citation.citationHandle,
						),
						extraction: {
							attemptedSpanIds: action.spanIds,
							promotedAttestationIds: extraction.promotedAttestationIds,
							rejectedCandidateCount: extraction.rejectedCandidateCount,
							verifiedCandidateCount: extraction.verifiedCandidateCount,
						},
					},
				});
			} catch (error) {
				stopReason = "tool-error";
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					rejectedAction: {
						reason:
							error instanceof Error
								? `Extraction failed: ${error.message}`
								: "Extraction failed.",
					},
				});
				break;
			}

			continue;
		}

		if (action.type === "inspect") {
			const inspectBudgetUsage = currentBudgetUsage({
				startedAt,
				extractionCalls,
				iterations: iteration,
				inspectedSpans: inspectedSpans.size + action.spanIds.length,
				modelCalls,
				retrievedSpans,
			});
			if (isBudgetExhausted(inspectBudgetUsage, budgets)) {
				stopReason = "budget-exhausted";
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					rejectedAction: {
						reason: "Inspect action exceeded evidence-loop budget.",
					},
				});
				break;
			}

			try {
				const inspected = await tools.inspect({ spanIds: action.spanIds });
				for (const span of inspected) {
					inspectedSpans.set(span.spanId, span);
				}
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					resultSummary: {
						chunks: search?.retrievalChunks.length ?? 0,
						citations: search?.citations.length ?? 0,
						citationHandles:
							search?.citations.map((citation) => citation.citationHandle) ??
							[],
						inspectedSpans: inspected.map((span) => ({
							spanId: span.spanId,
							sourceId: span.sourceId,
							title: span.title,
							section: span.section,
							locator: span.locator,
						})),
					},
				});
			} catch (error) {
				stopReason = "tool-error";
				iterations.push({
					iteration,
					requestedAction,
					validatedAction: traceAction(action),
					rejectedAction: {
						reason:
							error instanceof Error
								? `Inspection failed: ${error.message}`
								: "Inspection failed.",
					},
				});
				break;
			}

			if (
				isBudgetExhausted(
					currentBudgetUsage({
						startedAt,
						extractionCalls,
						inspectedSpans: inspectedSpans.size,
						iterations: iteration,
						modelCalls,
						retrievedSpans,
					}),
					budgets,
				)
			) {
				stopReason = "budget-exhausted";
				break;
			}

			continue;
		}

		try {
			search = await tools.search({
				query,
				queries: action.queries,
				exactPhrases: action.exactPhrases ?? [],
			});
		} catch (error) {
			stopReason = "tool-error";
			iterations.push({
				iteration,
				requestedAction,
				validatedAction: traceAction(action),
				rejectedAction: {
					reason:
						error instanceof Error
							? `Search failed: ${error.message}`
							: "Search failed.",
				},
			});
			break;
		}

		if (search.aiTrace) {
			searchTraceSteps.push(...search.aiTrace.steps);
		}
		retrievedSpans += search.retrievalChunks.length;
		iterations.push({
			iteration,
			requestedAction,
			validatedAction: traceAction(action),
			resultSummary: {
				chunks: search.retrievalChunks.length,
				citations: search.citations.length,
				citationHandles: search.citations.map(
					(citation) => citation.citationHandle,
				),
			},
		});

		if (
			isBudgetExhausted(
				currentBudgetUsage({
					startedAt,
					extractionCalls,
					inspectedSpans: inspectedSpans.size,
					iterations: iteration,
					modelCalls,
					retrievedSpans,
				}),
				budgets,
			)
		) {
			stopReason = "budget-exhausted";
			break;
		}
	}

	const budgetUsage = currentBudgetUsage({
		startedAt,
		extractionCalls,
		iterations: iterations.length,
		inspectedSpans: inspectedSpans.size,
		modelCalls,
		retrievedSpans,
	});
	const finalStopReason =
		stopReason ??
		(budgetUsage.iterations >= budgets.maxIterations
			? "budget-exhausted"
			: "insufficient-evidence");

	return {
		search,
		searchTraceSteps,
		traceStep: {
			stage: "evidence-loop",
			status: finalStopReason === "enough-evidence" ? "ready" : "stopped",
			model,
			durationMs: budgetUsage.elapsedMs,
			input: {
				query,
				budgets,
			},
			output: {
				stopReason: finalStopReason,
				budgetUsage,
				iterations,
				consideredEvidence: [...inspectedSpans.values()].map((span) => ({
					spanId: span.spanId,
					sourceId: span.sourceId,
					title: span.title,
					section: span.section,
					locator: span.locator,
					textPreview: truncateForTrace(span.text),
				})),
			},
		},
	};
}

function currentBudgetUsage({
	startedAt,
	extractionCalls,
	inspectedSpans,
	iterations,
	modelCalls,
	retrievedSpans,
}: {
	startedAt: number;
	extractionCalls?: number;
	inspectedSpans?: number;
	iterations: number;
	modelCalls: number;
	retrievedSpans: number;
}): EvidenceLoopTraceStep["output"]["budgetUsage"] {
	return {
		iterations,
		extractionCalls: extractionCalls ?? 0,
		modelCalls,
		retrievedSpans,
		inspectedSpans: inspectedSpans ?? 0,
		elapsedMs: elapsedMs(startedAt),
	};
}

function compactPlannerAction(action: unknown): unknown {
	if (!isRecord(action)) {
		return action;
	}

	return Object.fromEntries(
		Object.entries(action).filter(([, value]) => value !== null),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBudgetExhausted(
	usage: EvidenceLoopTraceStep["output"]["budgetUsage"],
	budgets: EvidenceLoopBudgets,
): boolean {
	return (
		usage.modelCalls > budgets.maxModelCalls ||
		usage.extractionCalls > budgets.maxExtractionCalls ||
		usage.retrievedSpans > budgets.maxRetrievedSpans ||
		usage.inspectedSpans > budgets.maxInspectedSpans ||
		usage.elapsedMs >= budgets.maxElapsedMs
	);
}

function spanIdsAreAvailable({
	action,
	inspectedSpans,
	search,
}: {
	action: Extract<EvidenceAction, { type: "inspect" | "extract" }>;
	inspectedSpans: Map<string, InspectedEvidenceSpan>;
	search: SearchResponse | null;
}) {
	const availableSpanIds = new Set([
		...(search?.retrievalChunks.map((chunk) => chunk.spanId) ?? []),
		...inspectedSpans.keys(),
	]);

	return action.spanIds.every((spanId) => availableSpanIds.has(spanId));
}

function normalizeEvidenceAction(action: EvidenceAction): EvidenceAction {
	if (action.type === "stop") {
		return action;
	}

	if (action.type === "inspect") {
		return {
			type: "inspect",
			spanIds: normalizeList(action.spanIds, 120),
		};
	}

	if (action.type === "extract") {
		return {
			type: "extract",
			spanIds: normalizeList(action.spanIds, 120),
		};
	}

	return {
		type: "search",
		queries: normalizeList(action.queries, 180),
		exactPhrases: normalizeList(action.exactPhrases ?? [], 120),
	};
}

function normalizeList(values: string[], maxLength: number): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];

	for (const value of values) {
		const compact = value.replace(/\s+/g, " ").trim();
		const key = compact.toLowerCase();

		if (!compact || seen.has(key)) {
			continue;
		}

		seen.add(key);
		normalized.push(compact.slice(0, maxLength));
	}

	return normalized;
}

function isRepeatedAction(
	action: EvidenceAction,
	iterations: EvidenceLoopTraceStep["output"]["iterations"],
): boolean {
	return iterations.some(
		(iteration) =>
			iteration.validatedAction !== undefined &&
			actionKey(iteration.validatedAction) === actionKey(traceAction(action)),
	);
}

function traceAction(
	action: EvidenceAction,
): NonNullable<
	EvidenceLoopTraceStep["output"]["iterations"][number]["validatedAction"]
> {
	if (action.type === "stop") {
		return {
			type: "stop",
			reason: action.reason,
		};
	}

	if (action.type === "inspect") {
		return {
			type: "inspect",
			spanIds: action.spanIds,
		};
	}

	if (action.type === "extract") {
		return {
			type: "extract",
			spanIds: action.spanIds,
		};
	}

	return {
		type: "search",
		queries: action.queries,
		exactPhrases: action.exactPhrases ?? [],
	};
}

function elapsedMs(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}

function truncateForTrace(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();

	return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function actionKey(
	action: NonNullable<
		EvidenceLoopTraceStep["output"]["iterations"][number]["validatedAction"]
	>,
): string {
	if (action.type === "stop") {
		return `stop:${action.reason}`;
	}

	if (action.type === "inspect" || action.type === "extract") {
		return `${action.type}:${[...(action.spanIds ?? [])]
			.map((value) => value.toLowerCase())
			.sort()
			.join("\u0000")}`;
	}

	return [
		"search",
		[...(action.queries ?? [])]
			.map((value) => value.toLowerCase())
			.sort()
			.join("\u0000"),
		[...(action.exactPhrases ?? [])]
			.map((value) => value.toLowerCase())
			.sort()
			.join("\u0000"),
	].join(":");
}

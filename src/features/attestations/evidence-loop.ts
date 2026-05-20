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
	maxElapsedMs: 8_000,
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

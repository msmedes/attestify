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
	maxIterations: 3,
	maxModelCalls: 3,
	maxRetrievedSpans: 80,
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

export const evidenceActionSchema = z.discriminatedUnion("type", [
	searchActionSchema,
	stopActionSchema,
]);

export type EvidenceAction = z.infer<typeof evidenceActionSchema>;

export type EvidenceLoopBudgets = typeof DEFAULT_BUDGETS;

export type EvidenceLoopPlannerInput = {
	query: string;
	iteration: number;
	previousActions: EvidenceLoopTraceStep["output"]["iterations"];
	citations: CitationUnit[];
	retrievalChunks: RetrievalChunk[];
	budgetUsage: EvidenceLoopTraceStep["output"]["budgetUsage"];
};

export type EvidenceLoopPlanner = (
	input: EvidenceLoopPlannerInput,
) => Promise<unknown>;

export type EvidenceLoopTools = {
	search: (input: {
		query: string;
		queries: string[];
		exactPhrases: string[];
	}) => Promise<SearchResponse>;
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
	let modelCalls = 0;
	let retrievedSpans = 0;

	for (let iteration = 1; iteration <= budgets.maxIterations; iteration += 1) {
		const budgetUsage = currentBudgetUsage({
			startedAt,
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

		const parsedAction = evidenceActionSchema.safeParse(requestedAction);
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
		iterations: iterations.length,
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
			},
		},
	};
}

function currentBudgetUsage({
	startedAt,
	iterations,
	modelCalls,
	retrievedSpans,
}: {
	startedAt: number;
	iterations: number;
	modelCalls: number;
	retrievedSpans: number;
}): EvidenceLoopTraceStep["output"]["budgetUsage"] {
	return {
		iterations,
		modelCalls,
		retrievedSpans,
		elapsedMs: elapsedMs(startedAt),
	};
}

function isBudgetExhausted(
	usage: EvidenceLoopTraceStep["output"]["budgetUsage"],
	budgets: EvidenceLoopBudgets,
): boolean {
	return (
		usage.modelCalls > budgets.maxModelCalls ||
		usage.retrievedSpans > budgets.maxRetrievedSpans ||
		usage.elapsedMs >= budgets.maxElapsedMs
	);
}

function normalizeEvidenceAction(action: EvidenceAction): EvidenceAction {
	if (action.type === "stop") {
		return action;
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
			JSON.stringify(iteration.validatedAction) ===
			JSON.stringify(traceAction(action)),
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

	return {
		type: "search",
		queries: action.queries,
		exactPhrases: action.exactPhrases ?? [],
	};
}

function elapsedMs(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}

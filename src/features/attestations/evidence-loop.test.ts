import { describe, expect, it } from "vitest";
import { type EvidenceLoopPlanner, runEvidenceLoop } from "./evidence-loop";
import type { SearchResponse } from "./types";

describe("runEvidenceLoop", () => {
	it("searches and stops successfully when the planner sees enough evidence", async () => {
		const actions: unknown[] = [
			{ type: "search", queries: ["mousetrap Hamlet"] },
			{ type: "stop", reason: "enough-evidence" },
		];
		const result = await runEvidenceLoop({
			planner: sequencePlanner(actions),
			query: "What is the mousetrap in Hamlet?",
			tools: {
				search: async () => fakeSearchResponse({ citations: 1, chunks: 2 }),
			},
		});

		expect(result.search?.citations).toHaveLength(1);
		expect(result.traceStep.stage).toBe("evidence-loop");
		expect(result.traceStep.status).toBe("ready");
		expect(result.traceStep.output.stopReason).toBe("enough-evidence");
		expect(result.traceStep.output.budgetUsage).toMatchObject({
			iterations: 2,
			modelCalls: 2,
			retrievedSpans: 2,
		});
		expect(result.traceStep.output.iterations[0]).toMatchObject({
			validatedAction: {
				type: "search",
				queries: ["mousetrap Hamlet"],
				exactPhrases: [],
			},
			resultSummary: {
				chunks: 2,
				citations: 1,
				citationHandles: ["att-1#span-1"],
			},
		});
		expect(result.traceStep.output.iterations[1]).toMatchObject({
			validatedAction: {
				type: "stop",
				reason: "enough-evidence",
			},
		});
	});

	it("exhausts iteration budget explicitly", async () => {
		const result = await runEvidenceLoop({
			budgets: {
				maxIterations: 1,
				maxModelCalls: 3,
				maxRetrievedSpans: 40,
				maxElapsedMs: 8_000,
			},
			planner: sequencePlanner([{ type: "search", queries: ["Alice rabbit"] }]),
			query: "What does Alice see?",
			tools: {
				search: async () => fakeSearchResponse({ citations: 0, chunks: 1 }),
			},
		});

		expect(result.traceStep.output.stopReason).toBe("budget-exhausted");
		expect(result.traceStep.output.budgetUsage.iterations).toBe(1);
	});

	it("allows an explicit stop after reaching the retrieved span budget exactly", async () => {
		const result = await runEvidenceLoop({
			budgets: {
				maxIterations: 3,
				maxModelCalls: 3,
				maxRetrievedSpans: 40,
				maxElapsedMs: 8_000,
			},
			planner: sequencePlanner([
				{ type: "search", queries: ["broad Hamlet query"] },
				{ type: "stop", reason: "enough-evidence" },
			]),
			query: "What happens in Hamlet?",
			tools: {
				search: async () => fakeSearchResponse({ citations: 1, chunks: 40 }),
			},
		});

		expect(result.traceStep.output.stopReason).toBe("enough-evidence");
		expect(result.traceStep.output.budgetUsage.retrievedSpans).toBe(40);
		expect(result.traceStep.output.iterations).toHaveLength(2);
	});

	it("stops with budget exhaustion when a search exceeds the retrieved span budget", async () => {
		const result = await runEvidenceLoop({
			budgets: {
				maxIterations: 3,
				maxModelCalls: 3,
				maxRetrievedSpans: 40,
				maxElapsedMs: 8_000,
			},
			planner: sequencePlanner([{ type: "search", queries: ["too broad"] }]),
			query: "What happens?",
			tools: {
				search: async () => fakeSearchResponse({ citations: 1, chunks: 41 }),
			},
		});

		expect(result.traceStep.status).toBe("stopped");
		expect(result.traceStep.output.stopReason).toBe("budget-exhausted");
	});

	it("rejects malformed planner actions without running tools", async () => {
		let searchCalls = 0;
		const result = await runEvidenceLoop({
			planner: sequencePlanner([{ type: "browse_web", query: "Hamlet" }]),
			query: "What is the mousetrap?",
			tools: {
				search: async () => {
					searchCalls += 1;
					return fakeSearchResponse({ citations: 1, chunks: 1 });
				},
			},
		});

		expect(searchCalls).toBe(0);
		expect(result.search).toBeNull();
		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.objectContaining({
					requestedAction: { type: "browse_web", query: "Hamlet" },
					rejectedAction: expect.objectContaining({
						reason: expect.stringContaining("Expected 'search' | 'stop'"),
					}),
				}),
			],
		});
	});

	it("rejects search actions that normalize to no usable queries", async () => {
		let searchCalls = 0;
		const result = await runEvidenceLoop({
			planner: sequencePlanner([{ type: "search", queries: ["   "] }]),
			query: "What is the mousetrap?",
			tools: {
				search: async () => {
					searchCalls += 1;
					return fakeSearchResponse({ citations: 1, chunks: 1 });
				},
			},
		});

		expect(searchCalls).toBe(0);
		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.objectContaining({
					rejectedAction: {
						reason: "Search action contained no non-empty queries.",
					},
				}),
			],
		});
	});

	it("keeps retrieval-only fallback behavior outside the loop contract", async () => {
		const fallback = fakeSearchResponse({ citations: 1, chunks: 1 });

		expect(fallback.queryMode).toBe("agentic");
		expect(fallback.citations).toHaveLength(1);
		expect(fallback.aiTrace?.steps).toHaveLength(0);
	});
});

function sequencePlanner(actions: unknown[]): EvidenceLoopPlanner {
	return async ({ iteration }) => actions[iteration - 1] ?? actions.at(-1);
}

function fakeSearchResponse({
	chunks,
	citations,
}: {
	chunks: number;
	citations: number;
}): SearchResponse {
	return {
		query: "fake query",
		queryMode: "agentic",
		retrievalQueries: ["fake query"],
		aiTrace: { steps: [] },
		answerLines: [],
		retrievalChunks: Array.from({ length: chunks }, (_, index) => ({
			spanId: `span-${index + 1}`,
			sourceId: "hamlet",
			title: "Hamlet",
			kind: "play",
			section: "Act 3",
			locator: `paragraph ${index + 1}`,
			text: "The Mousetrap",
			score: 1,
		})),
		citations: Array.from({ length: citations }, (_, index) => ({
			attestation: {
				id: `att-${index + 1}`,
				type: "passage",
				subject: "Hamlet",
				predicate: "contains passage",
				value: "The Mousetrap",
				context: "Act 3",
				anchorText: "The Mousetrap",
			},
			source: {
				sourceId: "hamlet",
				title: "Hamlet",
				kind: "play",
				attribution: "Fixture",
				updatedAt: "2026-05-20",
			},
			span: {
				spanId: `span-${index + 1}`,
				section: "Act 3",
				locator: `paragraph ${index + 1}`,
				text: "The Mousetrap",
			},
			citationHandle: `att-${index + 1}#span-${index + 1}`,
			citationIdentity: {
				status: "legacy",
				legacyHandle: `att-${index + 1}#span-${index + 1}`,
				reason: "Fixture",
				span: {
					legacySpanId: `span-${index + 1}`,
					locator: `paragraph ${index + 1}`,
				},
				attestation: {
					legacyAttestationId: `att-${index + 1}`,
				},
			},
			citationLabel: `[${index + 1}]`,
			support: {
				verifiedAgainstSource: true,
				method: "fixture",
			},
			score: 1,
		})),
		corpusStats: {
			documents: 1,
			spans: chunks,
			attestations: citations,
		},
	};
}

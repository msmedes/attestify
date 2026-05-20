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
				inspect: fakeInspect,
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
				maxInspectedSpans: 8,
				maxElapsedMs: 8_000,
			},
			planner: sequencePlanner([{ type: "search", queries: ["Alice rabbit"] }]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
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
				maxInspectedSpans: 8,
				maxElapsedMs: 8_000,
			},
			planner: sequencePlanner([
				{ type: "search", queries: ["broad Hamlet query"] },
				{ type: "stop", reason: "enough-evidence" },
			]),
			query: "What happens in Hamlet?",
			tools: {
				inspect: fakeInspect,
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
				maxInspectedSpans: 8,
				maxElapsedMs: 8_000,
			},
			planner: sequencePlanner([{ type: "search", queries: ["too broad"] }]),
			query: "What happens?",
			tools: {
				inspect: fakeInspect,
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
				inspect: fakeInspect,
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
						reason: expect.stringContaining(
							"Expected 'search' | 'inspect' | 'stop'",
						),
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
				inspect: fakeInspect,
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

	it("inspects initial spans and uses a narrower follow-up search for final citations", async () => {
		const searches: string[][] = [];
		const result = await runEvidenceLoop({
			planner: async ({ inspectedSpans, iteration, retrievalChunks }) => {
				if (iteration === 1) {
					return { type: "search", queries: ["rabbit hole Alice"] };
				}

				if (iteration === 2) {
					return {
						type: "inspect",
						spanIds: [retrievalChunks[0]?.spanId ?? "missing"],
					};
				}

				if (iteration === 3 && inspectedSpans[0]?.text.includes("watch")) {
					return {
						type: "search",
						queries: ["white rabbit watch waistcoat-pocket"],
						exactPhrases: ["waistcoat-pocket"],
					};
				}

				return { type: "stop", reason: "enough-evidence" };
			},
			query: "What does Alice see at the rabbit-hole?",
			tools: {
				inspect: async ({ spanIds }) =>
					spanIds.map((spanId) => ({
						spanId,
						sourceId: "alice-in-wonderland",
						title: "Alice's Adventures in Wonderland",
						section: "Chapter 1",
						locator: "paragraph 2",
						text: "Alice inspected the rabbit-hole span and saw a watch in the Rabbit's waistcoat-pocket.",
					})),
				search: async ({ queries }) => {
					searches.push(queries);

					return searches.length === 1
						? fakeSearchResponse({
								citations: 0,
								chunks: 1,
								sourceId: "alice-in-wonderland",
								text: "A broad rabbit-hole passage needs inspection.",
							})
						: fakeSearchResponse({
								citations: 1,
								chunks: 1,
								sourceId: "alice-in-wonderland",
								text: "The Rabbit took a watch out of its waistcoat-pocket.",
							});
				},
			},
		});

		expect(searches).toEqual([
			["rabbit hole Alice"],
			["white rabbit watch waistcoat-pocket"],
		]);
		expect(result.traceStep.status).toBe("ready");
		expect(result.traceStep.output.stopReason).toBe("enough-evidence");
		expect(result.traceStep.output.budgetUsage.iterations).toBe(4);
		expect(result.search?.citations).toHaveLength(1);
		expect(result.traceStep.output.consideredEvidence).toEqual([
			expect.objectContaining({
				spanId: "span-1",
				sourceId: "alice-in-wonderland",
				textPreview: expect.stringContaining("watch"),
			}),
		]);
		expect(
			result.traceStep.output.consideredEvidence.map((span) => span.spanId),
		).not.toEqual(
			result.search?.citations.map((citation) => citation.citationHandle),
		);
		expect(result.traceStep.output.iterations[1]).toMatchObject({
			validatedAction: {
				type: "inspect",
				spanIds: ["span-1"],
			},
			resultSummary: {
				inspectedSpans: [
					expect.objectContaining({
						spanId: "span-1",
						sourceId: "alice-in-wonderland",
					}),
				],
			},
		});
	});

	it("rejects repeated inspection actions", async () => {
		const result = await runEvidenceLoop({
			planner: sequencePlanner([
				{ type: "search", queries: ["Alice rabbit"] },
				{ type: "inspect", spanIds: ["span-1"] },
				{ type: "inspect", spanIds: ["span-1"] },
			]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
				search: async () => fakeSearchResponse({ citations: 0, chunks: 1 }),
			},
		});

		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.objectContaining({
					validatedAction: {
						type: "search",
						queries: ["Alice rabbit"],
						exactPhrases: [],
					},
				}),
				expect.objectContaining({
					validatedAction: {
						type: "inspect",
						spanIds: ["span-1"],
					},
				}),
				expect.objectContaining({
					rejectedAction: {
						reason:
							"Inspect action repeated already inspected span IDs: span-1.",
					},
				}),
			],
		});
	});

	it("rejects repeated inspection actions with reordered span IDs", async () => {
		const result = await runEvidenceLoop({
			planner: sequencePlanner([
				{ type: "search", queries: ["Alice rabbit"] },
				{ type: "inspect", spanIds: ["span-1", "span-2"] },
				{ type: "inspect", spanIds: ["span-2", "span-1"] },
			]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
				search: async () => fakeSearchResponse({ citations: 0, chunks: 2 }),
			},
		});

		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.any(Object),
				expect.objectContaining({
					validatedAction: {
						type: "inspect",
						spanIds: ["span-1", "span-2"],
					},
				}),
				expect.objectContaining({
					rejectedAction: {
						reason:
							"Inspect action repeated already inspected span IDs: span-2, span-1.",
					},
				}),
			],
		});
	});

	it("rejects partially repeated inspections", async () => {
		const result = await runEvidenceLoop({
			planner: sequencePlanner([
				{ type: "search", queries: ["Alice rabbit"] },
				{ type: "inspect", spanIds: ["span-1", "span-2"] },
				{ type: "inspect", spanIds: ["span-2", "span-3"] },
			]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
				search: async () => fakeSearchResponse({ citations: 0, chunks: 3 }),
			},
		});

		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.any(Object),
				expect.any(Object),
				expect.objectContaining({
					rejectedAction: {
						reason:
							"Inspect action repeated already inspected span IDs: span-2.",
					},
				}),
			],
		});
	});

	it("rejects repeated searches with reordered queries", async () => {
		const result = await runEvidenceLoop({
			planner: sequencePlanner([
				{ type: "search", queries: ["Alice rabbit", "waistcoat pocket"] },
				{ type: "search", queries: ["waistcoat pocket", "Alice rabbit"] },
			]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
				search: async () => fakeSearchResponse({ citations: 0, chunks: 1 }),
			},
		});

		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.objectContaining({
					validatedAction: {
						type: "search",
						queries: ["Alice rabbit", "waistcoat pocket"],
						exactPhrases: [],
					},
				}),
				expect.objectContaining({
					rejectedAction: {
						reason: "Repeated evidence action.",
					},
				}),
			],
		});
	});

	it("rejects repeated searches with changed casing", async () => {
		const result = await runEvidenceLoop({
			planner: sequencePlanner([
				{ type: "search", queries: ["Alice Rabbit"] },
				{ type: "search", queries: ["alice rabbit"] },
			]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
				search: async () => fakeSearchResponse({ citations: 0, chunks: 1 }),
			},
		});

		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.any(Object),
				expect.objectContaining({
					rejectedAction: {
						reason: "Repeated evidence action.",
					},
				}),
			],
		});
	});

	it("rejects inspection of spans the host has not retrieved", async () => {
		const result = await runEvidenceLoop({
			planner: sequencePlanner([
				{ type: "search", queries: ["Alice rabbit"] },
				{ type: "inspect", spanIds: ["missing-span"] },
			]),
			query: "What does Alice see?",
			tools: {
				inspect: fakeInspect,
				search: async () => fakeSearchResponse({ citations: 0, chunks: 1 }),
			},
		});

		expect(result.traceStep.output).toMatchObject({
			stopReason: "invalid-action",
			iterations: [
				expect.any(Object),
				expect.objectContaining({
					validatedAction: {
						type: "inspect",
						spanIds: ["missing-span"],
					},
					rejectedAction: {
						reason:
							"Inspect action referenced unavailable span IDs: missing-span.",
					},
				}),
			],
		});
	});
});

function sequencePlanner(actions: unknown[]): EvidenceLoopPlanner {
	return async ({ iteration }) => actions[iteration - 1] ?? actions.at(-1);
}

function fakeSearchResponse({
	chunks,
	citations,
	sourceId = "hamlet",
	text = "The Mousetrap",
}: {
	chunks: number;
	citations: number;
	sourceId?: string;
	text?: string;
}): SearchResponse {
	const title =
		sourceId === "hamlet" ? "Hamlet" : "Alice's Adventures in Wonderland";
	const kind = sourceId === "hamlet" ? "play" : "novel";

	return {
		query: "fake query",
		queryMode: "agentic",
		retrievalQueries: ["fake query"],
		aiTrace: { steps: [] },
		answerLines: [],
		retrievalChunks: Array.from({ length: chunks }, (_, index) => ({
			spanId: `span-${index + 1}`,
			sourceId,
			title,
			kind,
			section: "Act 3",
			locator: `paragraph ${index + 1}`,
			text,
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
				sourceId,
				title,
				kind,
				attribution: "Fixture",
				updatedAt: "2026-05-20",
			},
			span: {
				spanId: `span-${index + 1}`,
				section: "Act 3",
				locator: `paragraph ${index + 1}`,
				text,
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

async function fakeInspect({ spanIds }: { spanIds: string[] }) {
	return spanIds.map((spanId) => ({
		spanId,
		sourceId: "hamlet",
		title: "Hamlet",
		section: "Act 3",
		locator: "paragraph 1",
		text: "The Mousetrap",
	}));
}

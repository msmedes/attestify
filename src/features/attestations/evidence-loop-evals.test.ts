import { describe, expect, it } from "vitest";
import {
	type EvidenceLoopPlanner,
	type EvidenceLoopResult,
	runEvidenceLoop,
} from "./evidence-loop";
import type {
	CitationUnit,
	EvidenceLoopStopReason,
	SearchResponse,
} from "./types";

type DeterministicLoopEvalOutput = {
	caseId: string;
	retrievalSucceeded: boolean;
	citationUnitSucceeded: boolean;
	stopReason: EvidenceLoopStopReason;
	budgetUsage: EvidenceLoopResult["traceStep"]["output"]["budgetUsage"];
	iterationSummaries: Array<{
		action: string;
		chunks: number;
		citations: number;
		rejectionReason?: string;
	}>;
};

describe("deterministic evidence loop eval fixtures", () => {
	it("distinguishes no-support from supported citation evidence", async () => {
		const output = await runDeterministicLoopEval({
			actions: [
				{ type: "search", queries: ["missing evidence"] },
				{ type: "stop", reason: "insufficient-evidence" },
			],
			caseId: "no-support",
			searches: [fakeSearchResponse({ chunks: 0, citations: [] })],
		});

		expect(output).toMatchObject({
			caseId: "no-support",
			retrievalSucceeded: false,
			citationUnitSucceeded: false,
			stopReason: "insufficient-evidence",
		});
		expect(output.budgetUsage).toMatchObject({
			iterations: 2,
			modelCalls: 2,
			retrievedSpans: 0,
		});
	});

	it("does not count nearby retrieved chunks as citation-unit success", async () => {
		const output = await runDeterministicLoopEval({
			actions: [
				{ type: "search", queries: ["nearby but unsupported"] },
				{ type: "stop", reason: "insufficient-evidence" },
			],
			caseId: "nearby-but-not-citeable",
			expectedAnchorPattern: /needle evidence/i,
			searches: [
				fakeSearchResponse({
					chunks: 1,
					citations: [],
					text: "This nearby passage has topical overlap but no verified citation unit.",
				}),
			],
		});

		expect(output.retrievalSucceeded).toBe(true);
		expect(output.citationUnitSucceeded).toBe(false);
		expect(output.stopReason).toBe("insufficient-evidence");
		expect(output.iterationSummaries[0]).toMatchObject({
			action: "search",
			chunks: 1,
			citations: 0,
		});
	});

	it("records malformed action failures without spending tool calls", async () => {
		const output = await runDeterministicLoopEval({
			actions: [{ type: "browse_web", query: "unsupported tool" }],
			caseId: "malformed-action",
			searches: [
				fakeSearchResponse({ chunks: 1, citations: [citationUnit()] }),
			],
		});

		expect(output.stopReason).toBe("invalid-action");
		expect(output.budgetUsage).toMatchObject({
			iterations: 1,
			modelCalls: 1,
			retrievedSpans: 0,
		});
		expect(output.iterationSummaries[0]?.rejectionReason).toContain(
			"Expected 'search' | 'extract' | 'inspect' | 'stop'",
		);
	});

	it("records repeated action failures", async () => {
		const output = await runDeterministicLoopEval({
			actions: [
				{ type: "search", queries: ["same query"] },
				{ type: "search", queries: ["SAME QUERY"] },
			],
			caseId: "repeated-action",
			searches: [fakeSearchResponse({ chunks: 1, citations: [] })],
		});

		expect(output.stopReason).toBe("invalid-action");
		expect(output.budgetUsage).toMatchObject({
			iterations: 2,
			modelCalls: 2,
			retrievedSpans: 1,
		});
		expect(output.iterationSummaries[1]).toMatchObject({
			action: "search",
			rejectionReason: "Repeated evidence action.",
		});
	});

	it("records budget exhaustion and budget metadata", async () => {
		const output = await runDeterministicLoopEval({
			actions: [{ type: "search", queries: ["too broad"] }],
			budgets: {
				maxIterations: 1,
				maxModelCalls: 3,
				maxRetrievedSpans: 40,
				maxInspectedSpans: 8,
				maxExtractionCalls: 2,
				maxElapsedMs: 8_000,
			},
			caseId: "budget-exhaustion",
			searches: [fakeSearchResponse({ chunks: 1, citations: [] })],
		});

		expect(output.stopReason).toBe("budget-exhausted");
		expect(output.budgetUsage).toMatchObject({
			iterations: 1,
			modelCalls: 1,
			retrievedSpans: 1,
		});
	});

	it("records lazy extraction improving citation-unit success", async () => {
		const output = await runDeterministicLoopEval({
			actions: [
				{ type: "search", queries: ["lazy marker"] },
				{ type: "extract", spanIds: ["span-1"] },
				{ type: "stop", reason: "enough-evidence" },
			],
			caseId: "lazy-extraction-improves-citation",
			expectedAnchorPattern: /verified lazy marker/i,
			extractionCitations: [
				citationUnit({
					anchorText: "Verified lazy marker",
					citationHandle: "att-promoted#span-1",
				}),
			],
			searches: [
				fakeSearchResponse({
					chunks: 1,
					citations: [],
					text: "The span contains a lazy marker that needs extraction.",
				}),
			],
		});

		expect(output.retrievalSucceeded).toBe(true);
		expect(output.citationUnitSucceeded).toBe(true);
		expect(output.stopReason).toBe("enough-evidence");
		expect(output.budgetUsage).toMatchObject({
			extractionCalls: 1,
			iterations: 3,
		});
		expect(output.iterationSummaries[1]).toMatchObject({
			action: "extract",
			chunks: 1,
			citations: 1,
		});
	});
});

async function runDeterministicLoopEval({
	actions,
	budgets,
	caseId,
	expectedAnchorPattern = /./,
	extractionCitations = [],
	searches,
}: {
	actions: unknown[];
	budgets?: Parameters<typeof runEvidenceLoop>[0]["budgets"];
	caseId: string;
	expectedAnchorPattern?: RegExp;
	extractionCitations?: CitationUnit[];
	searches: SearchResponse[];
}): Promise<DeterministicLoopEvalOutput> {
	let searchIndex = 0;
	const result = await runEvidenceLoop({
		budgets,
		planner: sequencePlanner(actions),
		query: `fixture ${caseId}`,
		tools: {
			extract: async () => ({
				attempts: [
					{
						spanId: "span-1",
						cacheHit: false,
						rawCandidates: extractionCitations.length,
						verifiedCandidates: extractionCitations.length,
						promotions: extractionCitations.length,
						rejections: 0,
					},
				],
				citations: extractionCitations,
				promotedAttestationIds: extractionCitations.map(
					(citation) => citation.attestation.id,
				),
				rejectedCandidateCount: 0,
				verifiedCandidateCount: extractionCitations.length,
			}),
			inspect: async ({ spanIds }) =>
				spanIds.map((spanId) => ({
					spanId,
					sourceId: "fixture-source",
					title: "Fixture Source",
					section: "Section",
					locator: "paragraph 1",
					text: "Inspected fixture evidence.",
				})),
			search: async () =>
				searches[searchIndex++] ?? searches.at(-1) ?? emptySearch(),
		},
	});
	const search = result.search;

	return {
		caseId,
		retrievalSucceeded: (search?.retrievalChunks.length ?? 0) > 0,
		citationUnitSucceeded:
			search?.citations.some((citation) =>
				expectedAnchorPattern.test(citation.attestation.anchorText),
			) ?? false,
		stopReason: result.traceStep.output.stopReason,
		budgetUsage: result.traceStep.output.budgetUsage,
		iterationSummaries: result.traceStep.output.iterations.map((iteration) => ({
			action: iteration.validatedAction?.type ?? "rejected",
			chunks: iteration.resultSummary?.chunks ?? 0,
			citations: iteration.resultSummary?.citations ?? 0,
			rejectionReason: iteration.rejectedAction?.reason,
		})),
	};
}

function sequencePlanner(actions: unknown[]): EvidenceLoopPlanner {
	return async ({ iteration }) => actions[iteration - 1] ?? actions.at(-1);
}

function fakeSearchResponse({
	chunks,
	citations,
	text = "Fixture text",
}: {
	chunks: number;
	citations: CitationUnit[];
	text?: string;
}): SearchResponse {
	return {
		query: "fixture query",
		queryMode: "agentic",
		retrievalQueries: ["fixture query"],
		aiTrace: { steps: [] },
		answerLines: [],
		retrievalChunks: Array.from({ length: chunks }, (_, index) => ({
			spanId: `span-${index + 1}`,
			sourceId: "fixture-source",
			title: "Fixture Source",
			kind: "novel",
			section: "Section",
			locator: `paragraph ${index + 1}`,
			text,
			score: 1,
		})),
		citations,
		corpusStats: {
			documents: 1,
			spans: chunks,
			attestations: citations.length,
		},
	};
}

function emptySearch(): SearchResponse {
	return fakeSearchResponse({ chunks: 0, citations: [] });
}

function citationUnit({
	anchorText = "Needle evidence",
	citationHandle = "att-1#span-1",
}: {
	anchorText?: string;
	citationHandle?: string;
} = {}): CitationUnit {
	return {
		attestation: {
			id: citationHandle.split("#")[0] ?? "att-1",
			type: "passage",
			subject: "Fixture",
			predicate: "contains passage",
			value: anchorText,
			context: "Section",
			anchorText,
		},
		source: {
			sourceId: "fixture-source",
			title: "Fixture Source",
			kind: "novel",
			attribution: "Fixture",
			updatedAt: "2026-05-20",
		},
		span: {
			spanId: "span-1",
			section: "Section",
			locator: "paragraph 1",
			text: `Span with ${anchorText}.`,
		},
		citationHandle,
		citationIdentity: {
			status: "legacy",
			legacyHandle: citationHandle,
			reason: "Fixture",
			span: {
				legacySpanId: "span-1",
				locator: "paragraph 1",
			},
			attestation: {
				legacyAttestationId: citationHandle.split("#")[0] ?? "att-1",
			},
		},
		citationLabel: "[1]",
		support: {
			verifiedAgainstSource: true,
			method: "fixture",
		},
		score: 1,
	};
}

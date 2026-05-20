/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerPanel } from "./AnswerPanel";

afterEach(() => cleanup());

describe("AnswerPanel claim verification diagnostics", () => {
	it("renders claim support statuses and evidence handles distinctly", () => {
		render(
			<AnswerPanel
				aiAnswer={{
					status: "ready",
					segments: [{ type: "text", text: "Verified answer." }],
					claims: [
						claim("Supported claim.", "supported", ["att:1#span:1"]),
						claim("Weak claim.", "weak", ["att:2#span:2"]),
						claim("Contradicted claim.", "contradicted", ["att:3#span:3"]),
						claim("Missing claim.", "missing", []),
					],
				}}
				lines={[]}
				query="What happened?"
				retrievalQueries={["What happened?"]}
			/>,
		);

		expect(screen.getByText("Claim evidence support")).toBeTruthy();
		expect(screen.getByText("supported")).toBeTruthy();
		expect(screen.getByText("weak support")).toBeTruthy();
		expect(screen.getByText("contradicted")).toBeTruthy();
		expect(screen.getByText("missing support")).toBeTruthy();
		expect(
			screen.getAllByText(
				"source evidence support, not world-truth verification",
			),
		).toHaveLength(4);
		expect(screen.getByText("att:1#span:1")).toBeTruthy();
		expect(screen.getByText("att:3#span:3")).toBeTruthy();
	});
});

describe("AnswerPanel evidence-loop trace diagnostics", () => {
	it.each([
		["enough-evidence", "enough evidence"],
		["insufficient-evidence", "insufficient evidence"],
		["budget-exhausted", "budget exhausted"],
		["invalid-action", "invalid action"],
		["tool-error", "tool error"],
	] as const)("renders %s stop reason distinctly", (stopReason, label) => {
		render(
			<AnswerPanel
				aiTrace={{
					steps: [evidenceLoopStep(stopReason)],
				}}
				lines={[]}
				query="What happened?"
				retrievalQueries={["What happened?"]}
			/>,
		);

		expect(screen.getByText(label)).toBeTruthy();
		expect(screen.getByText("iteration 1")).toBeTruthy();
		expect(screen.getByText("search")).toBeTruthy();
		expect(screen.getByText("1 promoted / 0 rejected")).toBeTruthy();
		expect(screen.getByText("considered evidence")).toBeTruthy();
	});
});

function evidenceLoopStep(
	stopReason:
		| "enough-evidence"
		| "insufficient-evidence"
		| "budget-exhausted"
		| "invalid-action"
		| "tool-error",
) {
	return {
		stage: "evidence-loop" as const,
		status:
			stopReason === "enough-evidence"
				? ("ready" as const)
				: ("stopped" as const),
		durationMs: 42,
		input: {
			query: "What happened?",
			budgets: {
				maxIterations: 4,
				maxModelCalls: 4,
				maxRetrievedSpans: 80,
				maxInspectedSpans: 8,
				maxExtractionCalls: 2,
				maxElapsedMs: 8000,
			},
		},
		output: {
			stopReason,
			budgetUsage: {
				iterations: 2,
				modelCalls: 2,
				retrievedSpans: 3,
				inspectedSpans: 1,
				extractionCalls: 1,
				elapsedMs: 42,
			},
			iterations: [
				{
					iteration: 1,
					requestedAction: { type: "search", queries: ["query"] },
					validatedAction: {
						type: "search" as const,
						queries: ["query"],
						exactPhrases: [],
					},
					resultSummary: {
						chunks: 3,
						citations: 1,
						citationHandles: ["att:1#span:1"],
						extraction: {
							attemptedSpanIds: ["span:1"],
							promotedAttestationIds: ["att:1"],
							rejectedCandidateCount: 0,
							verifiedCandidateCount: 1,
						},
					},
				},
			],
			consideredEvidence: [
				{
					spanId: "span:1",
					sourceId: "source:1",
					title: "Source",
					section: "Section",
					locator: "paragraph 1",
					textPreview: "Evidence preview",
				},
			],
		},
	};
}

function claim(
	text: string,
	status: "supported" | "weak" | "contradicted" | "missing",
	citationHandles: string[],
) {
	return {
		text,
		citationHandles,
		verification: {
			status,
			method: "fake",
			rationale: `${status} rationale`,
			evidence: citationHandles.map((citationHandle) => ({
				citationHandle,
				attestationText: "attestation",
				anchorQuote: "quote",
				sourceSpanText: "source text",
				sourceTitle: "Source",
				locator: "Section, paragraph 1",
				citationIdentityStatus: "legacy" as const,
			})),
		},
	};
}

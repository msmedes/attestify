import { expect } from "vitest";
import {
	createHarness,
	createJudge,
	describeEval,
	type JudgeContext,
} from "vitest-evals";
import { answerCorpus } from "./answer.server";
import { serverEnv } from "./env.server";
import type {
	EvidenceLoopStopReason,
	QueryMode,
	SearchResponse,
} from "./types";

type MissedFollowUpEvalInput = {
	name: string;
	query: string;
	expectedSourceId: string;
	expectedAnchorPattern: string;
};

type ModeEvidenceResult = {
	mode: QueryMode;
	retrievalSucceeded: boolean;
	citationUnitSucceeded: boolean;
	citationCount: number;
	stopReason?: EvidenceLoopStopReason;
	budgetUsage?: {
		iterations: number;
		modelCalls: number;
		retrievedSpans: number;
		inspectedSpans: number;
		extractionCalls: number;
	};
};

type MissedFollowUpEvalOutput = {
	hybrid: ModeEvidenceResult;
	agentic: ModeEvidenceResult;
};

const missedFollowUpHarness = createHarness<
	MissedFollowUpEvalInput,
	MissedFollowUpEvalOutput
>({
	name: "attestify-evidence-loop-missed-follow-up",
	run: async ({ input }) => {
		const [hybrid, agentic] = await Promise.all([
			answerCorpus(input.query, "hybrid"),
			answerCorpus(input.query, "agentic"),
		]);
		const expectedAnchorPattern = new RegExp(input.expectedAnchorPattern, "i");

		return {
			output: {
				hybrid: summarizeModeEvidence({
					expectedAnchorPattern,
					expectedSourceId: input.expectedSourceId,
					mode: "hybrid",
					response: hybrid,
				}),
				agentic: summarizeModeEvidence({
					expectedAnchorPattern,
					expectedSourceId: input.expectedSourceId,
					mode: "agentic",
					response: agentic,
				}),
			},
			artifacts: {
				query: input.query,
				hybridCitationCount: hybrid.citations.length,
				agenticCitationCount: agentic.citations.length,
			},
			usage: {},
		};
	},
});

const MissedFollowUpJudge = createJudge(
	"MissedFollowUpJudge",
	async ({
		output,
	}: JudgeContext<MissedFollowUpEvalInput, MissedFollowUpEvalOutput>) => {
		const agenticFoundCitation = output.agentic.citationUnitSucceeded;
		const loopStoppedReady = output.agentic.stopReason === "enough-evidence";
		const agenticOutperformedOneShot =
			output.agentic.citationUnitSucceeded &&
			(!output.hybrid.citationUnitSucceeded ||
				output.agentic.citationCount > output.hybrid.citationCount);
		const score =
			Number(agenticFoundCitation) * 0.45 +
			Number(loopStoppedReady) * 0.25 +
			Number(agenticOutperformedOneShot) * 0.3;

		return {
			score,
			metadata: {
				rationale: [
					agenticFoundCitation
						? "agentic citation-unit success"
						: "agentic missed citation unit",
					loopStoppedReady
						? "loop stopped with enough evidence"
						: `loop stopped with ${output.agentic.stopReason ?? "no stop reason"}`,
					agenticOutperformedOneShot
						? "agentic outperformed one-shot retrieval"
						: "agentic did not outperform one-shot retrieval",
				].join("; "),
			},
		};
	},
);

describeEval(
	"attestify evidence loop missed follow-up",
	{
		harness: missedFollowUpHarness,
		judges: [MissedFollowUpJudge],
		judgeThreshold: 0.8,
		skipIf: () =>
			process.env.ATTESTIFY_MODEL_EVALS !== "true" || !serverEnv.openAi.apiKey,
	},
	(it) => {
		it.for([
			{
				name: "Alice rabbit-hole needs follow-up",
				query: "What does Alice see at the rabbit-hole?",
				expectedAnchorPattern: "watch|waistcoat-pocket",
				expectedSourceId: "alice-in-wonderland",
			},
		])("$name", async (input, { run }) => {
			const result = await run(input);

			expect(result.output.agentic.retrievalSucceeded).toBe(true);
			expect(result.output.agentic.citationUnitSucceeded).toBe(true);
			expect(result.output.agentic.stopReason).toBe("enough-evidence");
			expect(result.output.agentic.budgetUsage).toEqual(
				expect.objectContaining({
					iterations: expect.any(Number),
					modelCalls: expect.any(Number),
				}),
			);
		});
	},
);

function summarizeModeEvidence({
	expectedAnchorPattern,
	expectedSourceId,
	mode,
	response,
}: {
	expectedAnchorPattern: RegExp;
	expectedSourceId: string;
	mode: QueryMode;
	response: SearchResponse;
}): ModeEvidenceResult {
	const loopStep = response.aiTrace?.steps.find(
		(step) => step.stage === "evidence-loop",
	);

	return {
		mode,
		retrievalSucceeded: response.retrievalChunks.some(
			(chunk) => chunk.sourceId === expectedSourceId,
		),
		citationUnitSucceeded: response.citations.some(
			(citation) =>
				citation.source.sourceId === expectedSourceId &&
				expectedAnchorPattern.test(citation.attestation.anchorText),
		),
		citationCount: response.citations.length,
		stopReason: loopStep?.output.stopReason,
		budgetUsage: loopStep
			? {
					iterations: loopStep.output.budgetUsage.iterations,
					modelCalls: loopStep.output.budgetUsage.modelCalls,
					retrievedSpans: loopStep.output.budgetUsage.retrievedSpans,
					inspectedSpans: loopStep.output.budgetUsage.inspectedSpans,
					extractionCalls: loopStep.output.budgetUsage.extractionCalls,
				}
			: undefined,
	};
}

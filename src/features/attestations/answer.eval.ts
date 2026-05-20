import { expect } from "vitest";
import {
	createHarness,
	createJudge,
	describeEval,
	type JudgeContext,
} from "vitest-evals";
import { answerCorpus } from "./answer.server";
import { serverEnv } from "./env.server";

type AnswerEvalInput = {
	name: string;
	query: string;
	expectedAnswerPattern: string;
	expectedAnchorPattern: string;
	expectedSourceId: string;
};

type AnswerEvalOutput = {
	status: string;
	answerText: string;
	citations: Array<{
		citationHandle: string;
		sourceId: string;
		quote: string;
	}>;
	traceStages: string[];
};

const answerHarness = createHarness<AnswerEvalInput, AnswerEvalOutput>({
	name: "attestify-answer",
	run: async ({ input }) => {
		const response = await answerCorpus(input.query);
		const answerText =
			response.aiAnswer?.status === "ready"
				? response.aiAnswer.segments
						.map((segment) =>
							segment.type === "text"
								? segment.text
								: `[${segment.citationNumber}]`,
						)
						.join("")
				: "";

		return {
			output: {
				status: response.aiAnswer?.status ?? "missing",
				answerText,
				citations: response.citations.map((citation) => ({
					citationHandle: citation.citationHandle,
					sourceId: citation.source.sourceId,
					quote: citation.attestation.anchorText,
				})),
				traceStages: response.aiTrace?.steps.map((step) => step.stage) ?? [],
			},
			artifacts: {
				query: input.query,
				citationCount: response.citations.length,
			},
			usage: {},
		};
	},
});

const GroundedAnswerJudge = createJudge(
	"GroundedAnswerJudge",
	async ({
		input,
		output,
	}: JudgeContext<AnswerEvalInput, AnswerEvalOutput>) => {
		const answerPattern = new RegExp(input.expectedAnswerPattern, "i");
		const anchorPattern = new RegExp(input.expectedAnchorPattern, "i");
		const hasExpectedAnswer = answerPattern.test(output.answerText);
		const hasExpectedCitation = output.citations.some(
			(citation) =>
				citation.sourceId === input.expectedSourceId &&
				anchorPattern.test(citation.quote),
		);
		const hasRerank = output.traceStages.includes("rerank");
		const isReady = output.status === "ready";
		const score =
			Number(isReady) * 0.25 +
			Number(hasExpectedAnswer) * 0.3 +
			Number(hasExpectedCitation) * 0.35 +
			Number(hasRerank) * 0.1;

		return {
			score,
			metadata: {
				rationale: [
					isReady ? "answer ready" : `answer status ${output.status}`,
					hasExpectedAnswer
						? "expected answer present"
						: "expected answer absent",
					hasExpectedCitation
						? "expected citation present"
						: "expected citation absent",
					hasRerank ? "rerank traced" : "rerank missing",
				].join("; "),
			},
		};
	},
);

describeEval(
	"attestify generated answers",
	{
		harness: answerHarness,
		judges: [GroundedAnswerJudge],
		judgeThreshold: 0.8,
		skipIf: () => !serverEnv.openAi.apiKey,
	},
	(it) => {
		it.for([
			{
				name: "Alice rabbit-hole",
				query: "What does Alice see at the rabbit-hole?",
				expectedAnswerPattern: "rabbit|watch|waistcoat|hole",
				expectedAnchorPattern: "watch|waistcoat-pocket|rabbit-hole",
				expectedSourceId: "alice-in-wonderland",
			},
			{
				name: "Macbeth dagger",
				query: "What vision does Macbeth see before killing Duncan?",
				expectedAnswerPattern: "dagger",
				expectedAnchorPattern: "dagger|handle|Duncan",
				expectedSourceId: "macbeth",
			},
			{
				name: "Sherlock red-headed league",
				query: "What job does Jabez Wilson get in the Red-Headed League?",
				expectedAnswerPattern: "copy|encyclopaedia|league",
				expectedAnchorPattern: "copy|encyclopaedia|red-headed|league",
				expectedSourceId: "adventures-of-sherlock-holmes",
			},
		])("$name", async (input, { run }) => {
			const result = await run(input);

			expect(result.output.status).toBe("ready");
			expect(result.output.traceStages).toContain("rerank");
			expect(result.output.citations.length).toBeGreaterThan(0);
		});
	},
);

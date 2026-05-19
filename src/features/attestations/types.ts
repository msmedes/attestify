export type SourceKind =
	| "play"
	| "novel"
	| "story-collection"
	| "repair-manual"
	| "espresso-note"
	| "science-note"
	| "meeting-transcript";

export type AttestationType =
	| "utterance"
	| "quoted_phrase"
	| "passage"
	| "torque_spec"
	| "procedure_step"
	| "safety_warning"
	| "brew_parameter"
	| "adjustment_rule"
	| "causal_claim"
	| "literal_value";

export type SourceDocument = {
	sourceId: string;
	kind: SourceKind;
	title: string;
	attribution: string;
	updatedAt: string;
	sourceUrl?: string;
	spans: SourceSpan[];
};

export type SourceSpan = {
	spanId: string;
	sourceId: string;
	section: string;
	locator: string;
	text: string;
	attestations: Attestation[];
};

export type Attestation = {
	id: string;
	type: AttestationType;
	subject: string;
	predicate: string;
	value: string;
	context: string;
	anchorText: string;
};

export type CitationUnit = {
	attestation: Attestation;
	source: {
		sourceId: string;
		title: string;
		kind: SourceKind;
		attribution: string;
		updatedAt: string;
		sourceUrl?: string;
	};
	span: {
		spanId: string;
		section: string;
		locator: string;
		text: string;
	};
	citationHandle: string;
	support: {
		verifiedAgainstSource: boolean;
		method: string;
	};
	score: number;
};

export type RetrievalChunk = {
	spanId: string;
	sourceId: string;
	title: string;
	kind: SourceKind;
	section: string;
	locator: string;
	text: string;
	score: number;
};

export type SearchResponse = {
	query: string;
	retrievalQueries: string[];
	aiTrace?: AiTrace;
	answerLines: string[];
	aiAnswer?: AiAnswer;
	citations: CitationUnit[];
	retrievalChunks: RetrievalChunk[];
	corpusStats: {
		documents: number;
		spans: number;
		attestations: number;
	};
};

export type AiTrace = {
	steps: AiTraceStep[];
};

export type AiTraceStep =
	| ConfigTraceStep
	| RetrievalPlanTraceStep
	| RetrievalTraceStep
	| AnswerSynthesisTraceStep;

export type ConfigTraceStep = {
	stage: "config";
	status: "skipped";
	error: string;
};

export type RetrievalPlanTraceStep =
	| {
			stage: "retrieval-plan";
			status: "ready";
			model: string;
			durationMs: number;
			input: {
				query: string;
			};
			output: {
				queries: string[];
			};
	  }
	| {
			stage: "retrieval-plan";
			status: "failed";
			model: string;
			durationMs: number;
			input: {
				query: string;
			};
			error: string;
	  };

export type RetrievalTraceStep = {
	stage: "retrieval";
	status: "ready";
	input: {
		queries: string[];
	};
	output: {
		chunks: Array<{
			spanId: string;
			sourceId: string;
			section: string;
			locator: string;
			score: number;
		}>;
		citationHandles: string[];
	};
};

export type AnswerSynthesisTraceStep =
	| {
			stage: "answer-synthesis";
			status: "skipped";
			input: {
				query: string;
				citationCount: 0;
			};
			output: {
				reason: string;
			};
	  }
	| {
			stage: "answer-synthesis";
			status: "ready";
			model: string;
			durationMs: number;
			input: {
				query: string;
				citationHandles: string[];
			};
			output: {
				rawSegments: Array<{
					type: "text" | "quote";
					text?: string;
					citationHandle?: string;
				}>;
				selectedSegments: Array<
					| {
							type: "text";
							text: string;
					  }
					| {
							type: "citation";
							text?: string;
							citationHandle: string;
					  }
				>;
			};
	  }
	| {
			stage: "answer-synthesis";
			status: "failed";
			model: string;
			durationMs: number;
			input: {
				query: string;
				citationHandles: string[];
			};
			error: string;
	  };

export type SearchRequest = {
	query: string;
};

export type AiAnswer =
	| {
			status: "ready";
			segments: AiAnswerSegment[];
	  }
	| {
			status: "unavailable";
			message: string;
	  };

export type AiAnswerSegment =
	| {
			type: "text";
			text: string;
	  }
	| {
			type: "citation";
			citationHandle: string;
			citationNumber: number;
			text?: string;
			quote: string;
			sourceTitle: string;
			section: string;
			locator: string;
			sourceText: string;
	  };

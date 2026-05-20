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
	ingestion?: SourceDocumentIngestion;
	spans: SourceSpan[];
};

export type SourceSpan = {
	spanId: string;
	sourceId: string;
	section: string;
	locator: string;
	text: string;
	ingestion?: SourceSpanIngestion;
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
	ingestion?: VerifiedAttestationIngestion;
};

export type SourceDocumentIngestion = {
	connectorId: string;
	externalSourceId: string;
	sourceId: string;
	snapshotId: string;
	snapshotVersion: string;
	contentHash: string;
	extractionRunId?: string;
	extractorVersion?: string;
	verifiedAt?: string;
};

export type SourceSpanIngestion = {
	spanId: string;
};

export type VerifiedAttestationIngestion = {
	status: "verified";
	method: string;
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
	citationIdentity: CitationIdentity;
	citationLabel: string;
	support: {
		verifiedAgainstSource: boolean;
		method: string;
	};
	score: number;
};

export type CitationIdentity =
	| {
			status: "resolvable";
			legacyHandle: string;
			connectorId: string;
			externalSourceId: string;
			sourceSnapshot: {
				snapshotId: string;
				version?: string;
				contentHash?: string;
			};
			span: {
				spanId: string;
				legacySpanId: string;
				locator: string;
			};
			attestation: {
				attestationId: string;
				legacyAttestationId: string;
				extractionRunId?: string;
				extractorVersion?: string;
			};
	  }
	| {
			status: "legacy";
			legacyHandle: string;
			reason: string;
			span: {
				legacySpanId: string;
				locator: string;
			};
			attestation: {
				legacyAttestationId: string;
			};
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
	| RerankTraceStep
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

export type RerankTraceStep =
	| {
			stage: "rerank";
			status: "ready";
			model: string;
			durationMs: number;
			input: {
				query: string;
				citationHandles: string[];
				evidencePreview: Array<{
					index: number;
					citationHandle: string;
					source: string;
					location: string;
					quote: string;
					spanText: string;
					retrievalScore: number;
				}>;
			};
			output: {
				selected: Array<{
					citationHandle: string;
					relevance: number;
					rationale: string;
				}>;
			};
	  }
	| {
			stage: "rerank";
			status: "fallback";
			model: string;
			durationMs: number;
			input: {
				query: string;
				citationHandles: string[];
				evidencePreview: Array<{
					index: number;
					citationHandle: string;
					source: string;
					location: string;
					quote: string;
					spanText: string;
					retrievalScore: number;
				}>;
			};
			output: {
				reason: string;
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
				evidencePreview: Array<{
					index: number;
					citationHandle: string;
					source: string;
					location: string;
					quote: string;
					spanText: string;
				}>;
			};
			output: {
				rawClaims: Array<{
					text: string;
					citationHandles: string[];
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

export type QueryRunSummary = {
	id: string;
	createdAt: string;
	query: string;
	answerStatus: string;
	answerText: string;
	citationCount: number;
	retrievalQueryCount: number;
};

export type QueryRunDetail = QueryRunSummary & {
	response: SearchResponse;
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

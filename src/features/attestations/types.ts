export const SOURCE_KINDS = [
	"play",
	"novel",
	"story-collection",
	"repair-manual",
	"espresso-note",
	"science-note",
	"meeting-transcript",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const ATTESTATION_TYPES = [
	"utterance",
	"quoted_phrase",
	"passage",
	"torque_spec",
	"procedure_step",
	"safety_warning",
	"brew_parameter",
	"adjustment_rule",
	"causal_claim",
	"literal_value",
] as const;

export type AttestationType = (typeof ATTESTATION_TYPES)[number];

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
	snapshotVersion?: string;
	contentHash?: string;
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
	historyEvidence?: CitationHistoryEvidence;
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

export type CitationHistoryEvidence =
	| {
			status: "persisted";
			context: "current-response" | "saved-history";
			sourceSnapshotId?: string;
			sourceTitle: string;
			section: string;
			locator: string;
			quote: string;
			sourceText: string;
	  }
	| {
			status: "unresolved";
			reason: string;
			sourceTitle?: string;
			section?: string;
			locator?: string;
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

export const QUERY_MODES = ["hybrid", "agentic"] as const;

export type QueryMode = (typeof QUERY_MODES)[number];

export type SearchResponse = {
	query: string;
	queryMode: QueryMode;
	retrievalQueries: string[];
	retrievalDiagnostics?: RetrievalDiagnostics;
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

export type RetrievalDiagnostics = {
	rows: RetrievalDiagnosticRow[];
};

export type RetrievalDiagnosticRow = {
	rank: number;
	spanId: string;
	sourceId: string;
	title: string;
	section: string;
	locator: string;
	finalScore: number;
	lexicalScore: number;
	vectorScore: number;
	exactPhraseScore?: number;
	bestLexicalQuery: string;
	bestVectorQuery?: string;
	bestExactPhrase?: string;
	queryScores: Array<{
		query: string;
		lexicalScore: number;
		vectorScore?: number;
	}>;
};

export type AiTrace = {
	steps: AiTraceStep[];
	timing?: AiTraceTiming;
};

export type AiTraceTiming = {
	totalMs: number;
	modelProviderMs: number;
	applicationMs: number;
	spans: AiTraceTimingSpan[];
};

export type AiTraceTimingSpan = {
	stage: string;
	label: string;
	category: "application" | "model-provider";
	durationMs: number;
	model?: string;
	count?: number;
};

export type AiTraceStep =
	| ConfigTraceStep
	| RetrievalPlanTraceStep
	| RetrievalTraceStep
	| LazyExpansionTraceStep
	| RerankTraceStep
	| AgenticRetrievalTraceStep
	| EvidenceLoopTraceStep
	| AnswerSynthesisTraceStep
	| ClaimVerificationTraceStep;

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

export type AgenticRetrievalTraceStep =
	| {
			stage: "agentic-retrieval";
			status: "ready";
			model: string;
			durationMs: number;
			input: {
				query: string;
			};
			output: {
				exactPhrases: string[];
				searchQueries: string[];
				rationale: string;
			};
	  }
	| {
			stage: "agentic-retrieval";
			status: "failed";
			model: string;
			durationMs: number;
			input: {
				query: string;
			};
			error: string;
			output: {
				exactPhrases: string[];
				searchQueries: string[];
				rationale: string;
			};
	  };

export type EvidenceLoopStopReason =
	| "enough-evidence"
	| "insufficient-evidence"
	| "budget-exhausted"
	| "invalid-action"
	| "tool-error"
	| "model-unavailable";

export type EvidenceLoopTraceStep = {
	stage: "evidence-loop";
	status: "ready" | "stopped";
	model?: string;
	durationMs: number;
	input: {
		query: string;
		budgets: {
			maxIterations: number;
			maxModelCalls: number;
			maxRetrievedSpans: number;
			maxElapsedMs: number;
		};
	};
	output: {
		stopReason: EvidenceLoopStopReason;
		budgetUsage: {
			iterations: number;
			modelCalls: number;
			retrievedSpans: number;
			elapsedMs: number;
		};
		iterations: Array<{
			iteration: number;
			requestedAction: unknown;
			validatedAction?: {
				type: "search" | "stop";
				queries?: string[];
				exactPhrases?: string[];
				reason?: EvidenceLoopStopReason;
			};
			rejectedAction?: {
				reason: string;
			};
			resultSummary?: {
				chunks: number;
				citations: number;
				citationHandles: string[];
			};
		}>;
	};
};

export type RetrievalTraceStep = {
	stage: "retrieval";
	status: "ready";
	durationMs: number;
	input: {
		queries: string[];
	};
	output: {
		timing: AiTraceTimingSpan[];
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

export type LazyExpansionTraceStep = {
	stage: "lazy-expansion";
	status: "ready" | "skipped";
	input: {
		maxSpans: number;
		retrievedSpanIds: string[];
	};
	output: {
		attempts: Array<{
			spanId: string;
			cacheHit: boolean;
			rawCandidates: number;
			verifiedCandidates: number;
			promotions: number;
			rejections: number;
			verificationResults: Array<{
				candidateId: string;
				status: "verified" | "rejected";
				reason?: string;
			}>;
		}>;
		promotedAttestationIds: string[];
		skipped: Array<{
			spanId: string;
			reason: string;
		}>;
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

export type ClaimVerificationTraceStep = {
	stage: "claim-verification";
	status: "ready";
	input: {
		claimCount: number;
		citationHandles: string[];
	};
	output: {
		claims: AnswerClaim[];
	};
};

export type SearchRequest = {
	query: string;
	queryMode?: QueryMode;
};

export type QueryRunSummary = {
	id: string;
	createdAt: string;
	query: string;
	queryMode: QueryMode;
	answerStatus: string;
	answerText: string;
	citationCount: number;
	retrievalQueryCount: number;
	claimVerification?: ClaimVerificationSummary;
};

export type QueryRunDetail = QueryRunSummary & {
	response: SearchResponse;
};

export type ClaimVerificationSummary = {
	total: number;
	supported: number;
	weak: number;
	contradicted: number;
	missing: number;
};

export type AiAnswer =
	| {
			status: "ready";
			segments: AiAnswerSegment[];
			claims?: AnswerClaim[];
	  }
	| {
			status: "unavailable";
			message: string;
	  };

export type AnswerClaim = {
	text: string;
	citationHandles: string[];
	verification: {
		status: "supported" | "contradicted" | "weak" | "missing";
		method: string;
		rationale: string;
		evidence: Array<{
			citationHandle: string;
			attestationText: string;
			anchorQuote: string;
			sourceSpanText: string;
			sourceTitle: string;
			locator: string;
			sourceSnapshotId?: string;
			citationIdentityStatus: "resolvable" | "legacy";
		}>;
	};
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

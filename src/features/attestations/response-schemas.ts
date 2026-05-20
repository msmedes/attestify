import { z } from "zod";
import type {
	AiTrace,
	QueryRunDetail,
	QueryRunSummary,
	SearchResponse,
	SourceDocument,
	SourceSpan,
} from "./types";
import { ATTESTATION_TYPES, QUERY_MODES, SOURCE_KINDS } from "./types";

const sourceKindSchema = z.enum(SOURCE_KINDS);

const attestationTypeSchema = z.enum(ATTESTATION_TYPES);

const attestationSchema = z.object({
	id: z.string(),
	type: attestationTypeSchema,
	subject: z.string(),
	predicate: z.string(),
	value: z.string(),
	context: z.string(),
	anchorText: z.string(),
});

const sourceSpanSchema = z.object({
	spanId: z.string(),
	sourceId: z.string(),
	section: z.string(),
	locator: z.string(),
	text: z.string(),
	attestations: z.array(attestationSchema),
}) satisfies z.ZodType<SourceSpan>;

const sourceDocumentSchema = z.object({
	sourceId: z.string(),
	kind: sourceKindSchema,
	title: z.string(),
	attribution: z.string(),
	updatedAt: z.string(),
	sourceUrl: z.string().optional(),
	spans: z.array(sourceSpanSchema),
}) satisfies z.ZodType<SourceDocument>;

const citationIdentitySchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("resolvable"),
		legacyHandle: z.string(),
		connectorId: z.string(),
		externalSourceId: z.string(),
		sourceSnapshot: z.object({
			snapshotId: z.string(),
			version: z.string().optional(),
			contentHash: z.string().optional(),
		}),
		span: z.object({
			spanId: z.string(),
			legacySpanId: z.string(),
			locator: z.string(),
		}),
		attestation: z.object({
			attestationId: z.string(),
			legacyAttestationId: z.string(),
			extractionRunId: z.string().optional(),
			extractorVersion: z.string().optional(),
		}),
	}),
	z.object({
		status: z.literal("legacy"),
		legacyHandle: z.string(),
		reason: z.string(),
		span: z.object({
			legacySpanId: z.string(),
			locator: z.string(),
		}),
		attestation: z.object({
			legacyAttestationId: z.string(),
		}),
	}),
]);

const citationUnitSchema = z.object({
	attestation: attestationSchema,
	source: z.object({
		sourceId: z.string(),
		title: z.string(),
		kind: sourceKindSchema,
		attribution: z.string(),
		updatedAt: z.string(),
		sourceUrl: z.string().optional(),
	}),
	span: z.object({
		spanId: z.string(),
		section: z.string(),
		locator: z.string(),
		text: z.string(),
	}),
	citationHandle: z.string(),
	citationIdentity: citationIdentitySchema,
	citationLabel: z.string(),
	historyEvidence: z
		.discriminatedUnion("status", [
			z.object({
				status: z.literal("persisted"),
				context: z
					.enum(["current-response", "saved-history"])
					.default("saved-history"),
				sourceSnapshotId: z.string().optional(),
				sourceTitle: z.string(),
				section: z.string(),
				locator: z.string(),
				quote: z.string(),
				sourceText: z.string(),
			}),
			z.object({
				status: z.literal("unresolved"),
				reason: z.string(),
				sourceTitle: z.string().optional(),
				section: z.string().optional(),
				locator: z.string().optional(),
			}),
		])
		.optional(),
	support: z.object({
		verifiedAgainstSource: z.boolean(),
		method: z.string(),
	}),
	score: z.number(),
});

const retrievalChunkSchema = z.object({
	spanId: z.string(),
	sourceId: z.string(),
	title: z.string(),
	kind: sourceKindSchema,
	section: z.string(),
	locator: z.string(),
	text: z.string(),
	score: z.number(),
});

const retrievalDiagnosticsSchema = z.object({
	rows: z.array(
		z.object({
			rank: z.number(),
			spanId: z.string(),
			sourceId: z.string(),
			title: z.string(),
			section: z.string(),
			locator: z.string(),
			finalScore: z.number(),
			lexicalScore: z.number(),
			vectorScore: z.number(),
			exactPhraseScore: z.number().optional(),
			bestLexicalQuery: z.string(),
			bestVectorQuery: z.string().optional(),
			bestExactPhrase: z.string().optional(),
			queryScores: z.array(
				z.object({
					query: z.string(),
					lexicalScore: z.number(),
					vectorScore: z.number().optional(),
				}),
			),
		}),
	),
});

const aiAnswerSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("ready"),
		segments: z.array(
			z.discriminatedUnion("type", [
				z.object({
					type: z.literal("text"),
					text: z.string(),
				}),
				z.object({
					type: z.literal("citation"),
					citationHandle: z.string(),
					citationNumber: z.number(),
					text: z.string().optional(),
					quote: z.string(),
					sourceTitle: z.string(),
					section: z.string(),
					locator: z.string(),
					sourceText: z.string(),
				}),
			]),
		),
		claims: z
			.array(
				z.object({
					text: z.string(),
					citationHandles: z.array(z.string()),
					verification: z.object({
						status: z.enum(["supported", "contradicted", "weak", "missing"]),
						method: z.string(),
						rationale: z.string(),
						evidence: z.array(
							z.object({
								citationHandle: z.string(),
								attestationText: z.string(),
								anchorQuote: z.string(),
								sourceSpanText: z.string(),
								sourceTitle: z.string(),
								locator: z.string(),
								sourceSnapshotId: z.string().optional(),
								citationIdentityStatus: z.enum(["resolvable", "legacy"]),
							}),
						),
					}),
				}),
			)
			.optional(),
	}),
	z.object({
		status: z.literal("unavailable"),
		message: z.string(),
	}),
]);

const aiTraceSchema = z
	.object({
		steps: z.array(z.unknown()),
		timing: z.unknown().optional(),
	})
	.passthrough() as z.ZodType<AiTrace>;

export const searchResponseSchema = z.object({
	query: z.string(),
	queryMode: z.enum(QUERY_MODES).default("hybrid"),
	retrievalQueries: z.array(z.string()),
	retrievalDiagnostics: retrievalDiagnosticsSchema.optional(),
	aiTrace: aiTraceSchema.optional(),
	answerLines: z.array(z.string()),
	aiAnswer: aiAnswerSchema.optional(),
	citations: z.array(citationUnitSchema),
	retrievalChunks: z.array(retrievalChunkSchema),
	corpusStats: z.object({
		documents: z.number(),
		spans: z.number(),
		attestations: z.number(),
	}),
}) satisfies z.ZodType<SearchResponse>;

export const queryRunSummarySchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	query: z.string(),
	queryMode: z.enum(QUERY_MODES).default("hybrid"),
	answerStatus: z.string(),
	answerText: z.string(),
	citationCount: z.number(),
	retrievalQueryCount: z.number(),
	claimVerification: z
		.object({
			total: z.number(),
			supported: z.number(),
			weak: z.number(),
			contradicted: z.number(),
			missing: z.number(),
		})
		.optional(),
	evidenceLoop: z
		.object({
			stopReason: z.enum([
				"enough-evidence",
				"insufficient-evidence",
				"budget-exhausted",
				"invalid-action",
				"tool-error",
				"model-unavailable",
			]),
			iterations: z.number(),
			modelCalls: z.number(),
			retrievedSpans: z.number(),
			inspectedSpans: z.number(),
			extractionCalls: z.number(),
		})
		.optional(),
}) satisfies z.ZodType<QueryRunSummary>;

export const queryRunDetailSchema = queryRunSummarySchema.extend({
	response: searchResponseSchema,
}) satisfies z.ZodType<QueryRunDetail>;

export const corpusBrowserResponseSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("docs"),
		manifest: z.unknown(),
	}),
	z.object({
		type: z.literal("spans"),
		total: z.number(),
		spans: z.array(sourceSpanSchema),
	}),
	z.object({
		type: z.literal("claims"),
		total: z.number(),
		claims: z.array(
			z.object({
				attestation: attestationSchema,
				span: sourceSpanSchema,
				source: z.object({
					sourceId: z.string(),
					title: z.string(),
					kind: sourceKindSchema,
					sourceUrl: z.string().optional(),
				}),
			}),
		),
	}),
	z.object({
		type: z.literal("source"),
		source: sourceDocumentSchema.nullable(),
	}),
]);

export function parseApiResponse<T>(
	schema: z.ZodType<T>,
	body: unknown,
	context: string,
): T {
	const parsed = schema.safeParse(body);

	if (!parsed.success) {
		throw new Error(`${context} returned an invalid response.`);
	}

	return parsed.data;
}

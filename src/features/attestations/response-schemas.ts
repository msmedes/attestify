import { z } from "zod";
import type {
	AiTrace,
	QueryRunDetail,
	QueryRunSummary,
	SearchResponse,
	SourceDocument,
	SourceSpan,
} from "./types";

const sourceKindSchema = z.enum([
	"play",
	"novel",
	"story-collection",
	"repair-manual",
	"espresso-note",
	"science-note",
	"meeting-transcript",
]);

const attestationTypeSchema = z.enum([
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
]);

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
	}),
	z.object({
		status: z.literal("unavailable"),
		message: z.string(),
	}),
]);

const aiTraceSchema = z.custom<AiTrace>(
	(value) =>
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as { steps?: unknown }).steps),
);

export const searchResponseSchema = z.object({
	query: z.string(),
	retrievalQueries: z.array(z.string()),
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
	answerStatus: z.string(),
	answerText: z.string(),
	citationCount: z.number(),
	retrievalQueryCount: z.number(),
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

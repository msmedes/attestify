import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { citationLabel } from "./citation-identity";
import { queryRuns } from "./history.schema";
import type {
	AiAnswerSegment,
	CitationUnit,
	ClaimVerificationSummary,
	EvidenceLoopSummary,
	QueryRunDetail,
	QueryRunSummary,
	SearchResponse,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATABASE_PATH = path.join(DATA_DIR, "attestify.sqlite");
const persistedHistoryArraySchema = z.array(z.unknown());

let sqlite: Database.Database | null = null;

export class CorruptHistoryRunError extends Error {
	constructor(
		readonly runId: string,
		cause: unknown,
	) {
		super(
			cause instanceof Error
				? `History run ${runId} is corrupt: ${cause.message}`
				: `History run ${runId} is corrupt.`,
		);
		this.name = "CorruptHistoryRunError";
	}
}

function getDb() {
	mkdirSync(DATA_DIR, { recursive: true });

	if (!sqlite) {
		sqlite = new Database(DATABASE_PATH);
		sqlite.pragma("journal_mode = WAL");
		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS query_runs (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				query TEXT NOT NULL,
				answer_status TEXT NOT NULL,
				answer_text TEXT NOT NULL,
				retrieval_queries_json TEXT NOT NULL,
				retrieval_chunks_json TEXT NOT NULL,
				citations_json TEXT NOT NULL,
				ai_trace_json TEXT NOT NULL,
				response_json TEXT NOT NULL
			)
		`);
	}

	return drizzle(sqlite);
}

export function recordQueryRun(response: SearchResponse) {
	const db = getDb();

	db.insert(queryRuns)
		.values({
			id: randomUUID(),
			createdAt: new Date(),
			query: response.query,
			answerStatus: response.aiAnswer?.status ?? "retrieval-only",
			answerText: answerText(
				response.aiAnswer?.status === "ready" ? response.aiAnswer.segments : [],
			),
			retrievalQueriesJson: JSON.stringify(response.retrievalQueries),
			retrievalChunksJson: JSON.stringify(response.retrievalChunks),
			citationsJson: JSON.stringify(response.citations),
			aiTraceJson: JSON.stringify(response.aiTrace ?? { steps: [] }),
			responseJson: JSON.stringify(response),
		})
		.run();
}

export function tryRecordQueryRun(response: SearchResponse) {
	try {
		recordQueryRun(response);
	} catch (error) {
		console.error(
			"[attestation-rag:history]",
			JSON.stringify({
				event: "record-query-run-failed",
				query: response.query,
				error: error instanceof Error ? error.message : "Unknown error",
			}),
		);
	}
}

export function listQueryRunSummaries(limit = 12): QueryRunSummary[] {
	const db = getDb();

	return db
		.select()
		.from(queryRuns)
		.orderBy(desc(queryRuns.createdAt))
		.limit(limit)
		.all()
		.flatMap((run) => {
			try {
				return [summarizeRun(run)];
			} catch (error) {
				logCorruptHistoryRun(run.id, error);
				return [];
			}
		});
}

export function getQueryRunDetail(id: string): QueryRunDetail | null {
	const db = getDb();
	const run = db.select().from(queryRuns).where(eq(queryRuns.id, id)).get();

	if (!run) {
		return null;
	}

	try {
		return {
			...summarizeRun(run),
			response: upgradePersistedSearchResponse(
				parseHistoryJson(run.responseJson),
			),
		};
	} catch (error) {
		logCorruptHistoryRun(run.id, error);
		throw new CorruptHistoryRunError(run.id, error);
	}
}

export function upgradePersistedSearchResponse(value: unknown): SearchResponse {
	const response = value as SearchResponse;

	return {
		...response,
		queryMode: response.queryMode ?? "hybrid",
		citations: (response.citations ?? []).map((citation, index) =>
			upgradePersistedCitation(citation, index),
		),
	};
}

function upgradePersistedCitation(
	citation: CitationUnit,
	index: number,
): CitationUnit {
	const citationIdentity = citation.citationIdentity ?? {
		status: "legacy" as const,
		legacyHandle: citation.citationHandle,
		reason: "Persisted history citation predates structured citation identity.",
		span: {
			legacySpanId: citation.span.spanId,
			locator: citation.span.locator,
		},
		attestation: {
			legacyAttestationId: citation.attestation.id,
		},
	};
	const historyEvidence =
		citation.historyEvidence ??
		buildPersistedEvidence(citation, citationIdentity);

	return {
		...citation,
		citationIdentity,
		citationLabel: citation.citationLabel || citationLabel(index),
		historyEvidence:
			historyEvidence.status === "persisted"
				? { ...historyEvidence, context: "saved-history" }
				: historyEvidence,
	};
}

function buildPersistedEvidence(
	citation: CitationUnit,
	citationIdentity: CitationUnit["citationIdentity"],
): CitationUnit["historyEvidence"] {
	if (citation.span.text && citation.attestation.anchorText) {
		return {
			status: "persisted",
			context: "saved-history",
			sourceSnapshotId:
				citationIdentity.status === "resolvable"
					? citationIdentity.sourceSnapshot.snapshotId
					: undefined,
			sourceTitle: citation.source.title,
			section: citation.span.section,
			locator: citation.span.locator,
			quote: citation.attestation.anchorText,
			sourceText: citation.span.text,
		};
	}

	return {
		status: "unresolved",
		reason:
			"Persisted history citation is missing source text or quote evidence.",
		sourceTitle: citation.source.title,
		section: citation.span.section,
		locator: citation.span.locator,
	};
}

type QueryRunRow = typeof queryRuns.$inferSelect;

function summarizeRun(run: QueryRunRow): QueryRunSummary {
	const citations = persistedHistoryArraySchema.parse(
		parseHistoryJson(run.citationsJson),
	);
	const retrievalQueries = persistedHistoryArraySchema.parse(
		parseHistoryJson(run.retrievalQueriesJson),
	);
	const response = parseHistoryJson(run.responseJson) as SearchResponse;
	const claims =
		response.aiAnswer?.status === "ready"
			? (response.aiAnswer.claims ?? [])
			: [];

	return {
		id: run.id,
		createdAt: run.createdAt.toISOString(),
		query: run.query,
		queryMode: response.queryMode ?? "hybrid",
		answerStatus: run.answerStatus,
		answerText: run.answerText,
		citationCount: citations.length,
		retrievalQueryCount: retrievalQueries.length,
		claimVerification:
			claims.length > 0
				? claims.reduce(
						(summary, claim) => {
							summary.total += 1;
							summary[claim.verification.status] += 1;

							return summary;
						},
						{
							total: 0,
							supported: 0,
							weak: 0,
							contradicted: 0,
							missing: 0,
						} satisfies ClaimVerificationSummary,
					)
				: undefined,
		evidenceLoop: summarizeEvidenceLoop(response),
	};
}

function summarizeEvidenceLoop(
	response: SearchResponse,
): EvidenceLoopSummary | undefined {
	const step = response.aiTrace?.steps.find(
		(traceStep) => traceStep.stage === "evidence-loop",
	);

	if (!step) {
		return undefined;
	}

	return {
		stopReason: step.output.stopReason,
		iterations: step.output.budgetUsage.iterations,
		modelCalls: step.output.budgetUsage.modelCalls,
		retrievedSpans: step.output.budgetUsage.retrievedSpans,
		inspectedSpans: step.output.budgetUsage.inspectedSpans,
		extractionCalls: step.output.budgetUsage.extractionCalls,
	};
}

function parseHistoryJson(json: string): unknown {
	try {
		return JSON.parse(json) as unknown;
	} catch (error) {
		throw new Error(
			error instanceof Error
				? `Invalid persisted history JSON: ${error.message}`
				: "Invalid persisted history JSON.",
		);
	}
}

function logCorruptHistoryRun(id: string, error: unknown) {
	console.error(
		"[attestation-rag:history]",
		JSON.stringify({
			event: "skip-corrupt-history-run",
			id,
			error: error instanceof Error ? error.message : "Unknown error",
		}),
	);
}

function answerText(segments: AiAnswerSegment[]): string {
	return segments
		.map((segment) => {
			if (segment.type === "text") {
				return segment.text;
			}

			return `[${segment.citationNumber}]`;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { queryRuns } from "./history.schema";
import type {
	AiAnswerSegment,
	QueryRunDetail,
	QueryRunSummary,
	SearchResponse,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATABASE_PATH = path.join(DATA_DIR, "attestify.sqlite");

let sqlite: Database.Database | null = null;

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
			answerText: answerText(response.aiAnswer?.segments ?? []),
			retrievalQueriesJson: JSON.stringify(response.retrievalQueries),
			retrievalChunksJson: JSON.stringify(response.retrievalChunks),
			citationsJson: JSON.stringify(response.citations),
			aiTraceJson: JSON.stringify(response.aiTrace ?? { steps: [] }),
			responseJson: JSON.stringify(response),
		})
		.run();
}

export function listQueryRunSummaries(limit = 12): QueryRunSummary[] {
	const db = getDb();

	return db
		.select()
		.from(queryRuns)
		.orderBy(desc(queryRuns.createdAt))
		.limit(limit)
		.all()
		.map((run) => {
			return summarizeRun(run);
		});
}

export function getQueryRunDetail(id: string): QueryRunDetail | null {
	const db = getDb();
	const run = db.select().from(queryRuns).where(eq(queryRuns.id, id)).get();

	if (!run) {
		return null;
	}

	return {
		...summarizeRun(run),
		response: JSON.parse(run.responseJson) as SearchResponse,
	};
}

type QueryRunRow = typeof queryRuns.$inferSelect;

function summarizeRun(run: QueryRunRow): QueryRunSummary {
	const citations = JSON.parse(run.citationsJson) as unknown[];
	const retrievalQueries = JSON.parse(run.retrievalQueriesJson) as unknown[];

	return {
		id: run.id,
		createdAt: run.createdAt.toISOString(),
		query: run.query,
		answerStatus: run.answerStatus,
		answerText: run.answerText,
		citationCount: citations.length,
		retrievalQueryCount: retrievalQueries.length,
	};
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

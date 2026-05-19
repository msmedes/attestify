import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const queryRuns = sqliteTable("query_runs", {
	id: text("id").primaryKey(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	query: text("query").notNull(),
	answerStatus: text("answer_status").notNull(),
	answerText: text("answer_text").notNull(),
	retrievalQueriesJson: text("retrieval_queries_json").notNull(),
	retrievalChunksJson: text("retrieval_chunks_json").notNull(),
	citationsJson: text("citations_json").notNull(),
	aiTraceJson: text("ai_trace_json").notNull(),
	responseJson: text("response_json").notNull(),
});

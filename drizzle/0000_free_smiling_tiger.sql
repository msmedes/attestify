CREATE TABLE `query_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`query` text NOT NULL,
	`answer_status` text NOT NULL,
	`answer_text` text NOT NULL,
	`retrieval_queries_json` text NOT NULL,
	`retrieval_chunks_json` text NOT NULL,
	`citations_json` text NOT NULL,
	`ai_trace_json` text NOT NULL,
	`response_json` text NOT NULL
);

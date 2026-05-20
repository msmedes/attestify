import { Link } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Clock3, FileSearch } from "lucide-react";
import type { ReactNode } from "react";
import { useQueryHistoryRun } from "../queries";
import type { QueryRunDetail, RetrievalDiagnosticRow } from "../types";
import { AnswerPanel } from "./internal/AnswerPanel";
import { EvidenceColumn } from "./internal/EvidenceColumn";
import { RawChunkPanel } from "./internal/RawChunkPanel";

type QueryRunPageProps = {
	runId: string;
};

export function QueryRunPage({ runId }: QueryRunPageProps) {
	const run = useQueryHistoryRun(runId);

	if (run.isError) {
		return (
			<QueryRunShell>
				<div className="border border-[#9f2f2f] bg-[#fff7f4] p-4 text-[#7a2424]">
					{run.error.message}
				</div>
			</QueryRunShell>
		);
	}

	if (run.isLoading) {
		return (
			<QueryRunShell>
				<output className="block border border-[#20211f] bg-[#ffffff] p-5 text-[#686a64]">
					Loading saved query...
				</output>
			</QueryRunShell>
		);
	}

	if (!run.data) {
		return (
			<QueryRunShell>
				<div className="border border-[#9f2f2f] bg-[#fff7f4] p-4 text-[#7a2424]">
					Saved query was not found.
				</div>
			</QueryRunShell>
		);
	}

	return <QueryRunDetailView run={run.data} />;
}

function QueryRunDetailView({ run }: { run: QueryRunDetail }) {
	const { response } = run;

	return (
		<main className="min-h-screen bg-[#f7f7f2] text-[#20211f]">
			<div className="grid min-h-screen grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]">
				<section className="min-w-0">
					<header className="border-[#20211f] border-b bg-[#f7f7f2] px-5 py-5 md:px-8">
						<Link
							className="mb-5 inline-flex min-h-10 items-center gap-2 border border-[#20211f] bg-[#ffffff] px-3 text-sm transition-colors transition-transform hover:bg-[#d8eee7] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-2"
							to="/"
						>
							<ArrowLeft aria-hidden="true" size={16} />
							Lab
						</Link>
						<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
							<div className="min-w-0">
								<div className="mb-2 flex items-center gap-2 text-[#3b6d65] text-sm">
									<FileSearch aria-hidden="true" size={16} />
									<span>Saved query run</span>
								</div>
								<h1 className="max-w-5xl break-words font-semibold text-3xl leading-tight md:text-5xl">
									{run.query}
								</h1>
							</div>
							<div className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[420px]">
								<QueryMetric label="mode" value={run.queryMode} />
								<QueryMetric
									label="created"
									value={new Date(run.createdAt).toLocaleString()}
								/>
								<QueryMetric
									label="citations"
									value={String(run.citationCount)}
								/>
								<QueryMetric
									label="retrieval queries"
									value={String(run.retrievalQueryCount)}
								/>
							</div>
						</div>
					</header>

					<div className="grid gap-5 p-5 md:p-8">
						<RunTimingSummary run={run} />
						<RetrievalDiagnosticsPanel
							rows={response.retrievalDiagnostics?.rows ?? []}
						/>
						<AnswerPanel
							aiAnswer={response.aiAnswer}
							aiTrace={response.aiTrace}
							lines={response.answerLines}
							query={response.query}
							retrievalQueries={response.retrievalQueries}
						/>
						<RawChunkPanel chunks={response.retrievalChunks} />
					</div>
				</section>

				<EvidenceColumn citations={response.citations} />
			</div>
		</main>
	);
}

function QueryRunShell({ children }: { children: ReactNode }) {
	return (
		<main className="min-h-screen bg-[#f7f7f2] p-5 text-[#20211f] md:p-8">
			<Link
				className="mb-5 inline-flex min-h-10 items-center gap-2 border border-[#20211f] bg-[#ffffff] px-3 text-sm transition-colors transition-transform hover:bg-[#d8eee7] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-2"
				to="/"
			>
				<ArrowLeft aria-hidden="true" size={16} />
				Lab
			</Link>
			{children}
		</main>
	);
}

function QueryMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="border border-[#20211f] bg-[#ffffff] px-3 py-2">
			<p className="text-[#6f716d] text-xs">{label}</p>
			<p className="font-semibold text-[#20211f] tabular-nums">{value}</p>
		</div>
	);
}

function RunTimingSummary({ run }: { run: QueryRunDetail }) {
	const timing = run.response.aiTrace?.timing;

	if (!timing) {
		return (
			<section className="border border-[#20211f] bg-[#ffffff] p-4 text-[#686a64]">
				This run predates timing summaries.
			</section>
		);
	}

	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<div className="flex items-center justify-between border-[#20211f] border-b px-4 py-3">
				<div>
					<p className="text-[#6f716d] text-sm">Waterfall totals</p>
					<h2 className="font-semibold text-xl">Runtime split</h2>
				</div>
				<Clock3 aria-hidden="true" className="text-[#c14f2f]" size={22} />
			</div>
			<div className="grid gap-3 p-4 sm:grid-cols-3">
				<QueryMetric label="total" value={`${timing.totalMs}ms`} />
				<QueryMetric
					label="model provider"
					value={`${timing.modelProviderMs}ms`}
				/>
				<QueryMetric label="application" value={`${timing.applicationMs}ms`} />
			</div>
		</section>
	);
}

function RetrievalDiagnosticsPanel({
	rows,
}: {
	rows: RetrievalDiagnosticRow[];
}) {
	if (rows.length === 0) {
		return (
			<section className="border border-[#20211f] bg-[#ffffff] p-4 text-[#686a64]">
				This run predates retrieval diagnostics.
			</section>
		);
	}

	const maxScore = Math.max(...rows.map((row) => row.finalScore), 1);

	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<div className="flex items-center justify-between border-[#20211f] border-b px-4 py-3">
				<div>
					<p className="text-[#6f716d] text-sm">Retrieval score shape</p>
					<h2 className="font-semibold text-xl">Similarity diagnostics</h2>
				</div>
				<BarChart3 aria-hidden="true" className="text-[#3b6d65]" size={22} />
			</div>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[920px] border-collapse text-left text-sm">
					<thead>
						<tr className="border-[#d7d8d1] border-b bg-[#fbfcf7] text-[#4a4c48]">
							<th className="px-3 py-2 font-medium">rank</th>
							<th className="px-3 py-2 font-medium">span</th>
							<th className="px-3 py-2 font-medium">score</th>
							<th className="px-3 py-2 font-medium">lexical</th>
							<th className="px-3 py-2 font-medium">vector</th>
							<th className="px-3 py-2 font-medium">exact</th>
							<th className="px-3 py-2 font-medium">best query</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<RetrievalDiagnosticTableRow
								key={row.spanId}
								maxScore={maxScore}
								row={row}
							/>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function RetrievalDiagnosticTableRow({
	maxScore,
	row,
}: {
	maxScore: number;
	row: RetrievalDiagnosticRow;
}) {
	const width = `${Math.max(2, Math.round((row.finalScore / maxScore) * 100))}%`;
	const bestQuery = row.bestVectorQuery
		? `vector: ${row.bestVectorQuery}`
		: `lexical: ${row.bestLexicalQuery}`;

	return (
		<tr className="border-[#d7d8d1] border-b align-top last:border-b-0">
			<td className="px-3 py-3 font-medium tabular-nums">{row.rank}</td>
			<td className="max-w-[280px] px-3 py-3">
				<p className="font-medium">{row.title}</p>
				<p className="text-[#686a64] text-xs">
					{row.section}, {row.locator}
				</p>
				<p className="mt-1 break-all text-[#6f716d] text-xs">{row.spanId}</p>
			</td>
			<td className="px-3 py-3">
				<p className="mb-1 font-medium tabular-nums">
					{row.finalScore.toFixed(3)}
				</p>
				<div className="h-2 w-32 border border-[#d7d8d1] bg-[#ffffff]">
					<div className="h-full bg-[#20211f]" style={{ width }} />
				</div>
			</td>
			<td className="px-3 py-3 tabular-nums">{row.lexicalScore.toFixed(3)}</td>
			<td className="px-3 py-3 tabular-nums">{row.vectorScore.toFixed(3)}</td>
			<td className="px-3 py-3 tabular-nums">
				{typeof row.exactPhraseScore === "number"
					? row.exactPhraseScore.toFixed(3)
					: "n/a"}
			</td>
			<td className="max-w-[340px] px-3 py-3">
				<p className="break-words text-[#20211f]">{bestQuery}</p>
				{row.bestExactPhrase ? (
					<p className="mt-1 break-words text-[#c14f2f] text-xs">
						exact: {row.bestExactPhrase}
					</p>
				) : null}
				<details className="mt-2">
					<summary className="cursor-pointer text-[#3b6d65] text-xs">
						per-query scores
					</summary>
					<div className="mt-2 grid gap-1">
						{row.queryScores.map((score) => (
							<div
								className="border border-[#d7d8d1] bg-[#fbfcf7] p-2"
								key={score.query}
							>
								<p className="break-words">{score.query}</p>
								<p className="text-[#686a64] text-xs tabular-nums">
									lex {score.lexicalScore.toFixed(3)}
									{typeof score.vectorScore === "number"
										? ` · vec ${score.vectorScore.toFixed(3)}`
										: " · vec none"}
								</p>
							</div>
						))}
					</div>
				</details>
			</td>
		</tr>
	);
}

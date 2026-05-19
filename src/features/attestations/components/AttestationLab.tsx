import { Database, Search } from "lucide-react";
import { useState } from "react";
import {
	useQueryHistory,
	useQueryHistoryRun,
	useSearchAttestations,
} from "../queries";
import { AnswerPanel } from "./internal/AnswerPanel";
import { CorpusBrowser, type CorpusView } from "./internal/CorpusBrowser";
import { CorpusSidebar } from "./internal/CorpusSidebar";
import { EvidenceColumn } from "./internal/EvidenceColumn";
import { QueryHistoryPanel } from "./internal/QueryHistoryPanel";
import { RawChunkPanel } from "./internal/RawChunkPanel";
import { SearchBar } from "./internal/SearchBar";

const sampleQueries = [
	"What is the mousetrap in Hamlet?",
	"What does Raskolnikov bring to Alyona?",
	"What does Elizabeth say about Darcy?",
	"What does Holmes observe about Irene Adler?",
	"What does Alice see at the rabbit-hole?",
];

export function AttestationLab() {
	const [query, setQuery] = useState(sampleQueries[0]);
	const [corpusView, setCorpusView] = useState<CorpusView | null>(null);
	const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<
		string | null
	>(null);
	const search = useSearchAttestations();
	const history = useQueryHistory();
	const selectedHistoryRun = useQueryHistoryRun(selectedHistoryRunId);
	const result = selectedHistoryRunId
		? (selectedHistoryRun.data?.response ?? null)
		: (search.data ?? null);

	function submitQuery(nextQuery: string) {
		const trimmedQuery = nextQuery.trim();

		if (trimmedQuery.length < 2 || search.isPending) {
			return;
		}

		setSelectedHistoryRunId(null);
		search.mutate({ query: trimmedQuery });
	}

	return (
		<main className="min-h-screen bg-[#f7f7f2] text-[#20211f]">
			<div className="grid min-h-screen grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)]">
				<CorpusSidebar
					activeView={corpusView}
					onViewSelected={setCorpusView}
					stats={result?.corpusStats ?? null}
				/>

				<section className="flex min-h-screen flex-col">
					<header className="border-[#20211f] border-b bg-[#f7f7f2] px-5 py-5 md:px-8">
						<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
							<div>
								<div className="mb-2 flex items-center gap-2 text-[#3b6d65] text-sm">
									<Database aria-hidden="true" size={16} />
									<span>Vectra span index + citation attestations</span>
								</div>
								<h1 className="max-w-4xl font-semibold text-3xl md:text-5xl">
									Source-faithful retrieval lab
								</h1>
							</div>

							<div className="flex flex-wrap gap-2">
								{sampleQueries.map((sampleQuery) => (
									<button
										className="min-h-10 border border-[#20211f] bg-[#ffffff] px-3 text-sm transition-colors transition-transform hover:bg-[#d8eee7] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-2 disabled:opacity-60 disabled:active:scale-100"
										disabled={search.isPending}
										key={sampleQuery}
										onClick={() => {
											setQuery(sampleQuery);
											submitQuery(sampleQuery);
										}}
										type="button"
									>
										{sampleQuery}
									</button>
								))}
							</div>
						</div>
					</header>

					<div className="border-[#20211f] border-b bg-[#ffffff] px-5 py-4 md:px-8">
						<SearchBar
							isPending={search.isPending}
							onQueryChanged={setQuery}
							onSubmitted={submitQuery}
							query={query}
						/>
					</div>

					<div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]">
						<section className="flex min-h-0 flex-col gap-5 p-5 md:p-8">
							{search.isError ? (
								<div className="border border-[#9f2f2f] bg-[#fff7f4] p-4 text-[#7a2424]">
									{search.error.message}
								</div>
							) : null}

							{selectedHistoryRun.isError ? (
								<div className="border border-[#9f2f2f] bg-[#fff7f4] p-4 text-[#7a2424]">
									{selectedHistoryRun.error.message}
								</div>
							) : null}

							{selectedHistoryRunId && selectedHistoryRun.isPending ? (
								<div className="border border-[#20211f] bg-[#ffffff] p-4 text-[#686a64]">
									Loading saved run...
								</div>
							) : null}

							{result ? (
								<>
									{corpusView ? <CorpusBrowser view={corpusView} /> : null}
									<AnswerPanel
										aiAnswer={result.aiAnswer}
										aiTrace={result.aiTrace}
										lines={result.answerLines}
										query={result.query}
										retrievalQueries={result.retrievalQueries}
									/>
									<RawChunkPanel chunks={result.retrievalChunks} />
								</>
							) : corpusView ? (
								<CorpusBrowser view={corpusView} />
							) : (
								<div className="grid min-h-[360px] place-items-center border border-[#20211f] bg-[#ffffff] p-8">
									<div className="max-w-md text-center">
										<Search
											aria-hidden="true"
											className="mx-auto mb-5 text-[#c14f2f]"
											size={42}
										/>
										<h2 className="font-semibold text-2xl leading-tight">
											Run a query against the seed corpus.
										</h2>
									</div>
								</div>
							)}
							<QueryHistoryPanel
								activeRunId={selectedHistoryRunId}
								isLoading={history.isLoading}
								onRunSelected={(run) => {
									setQuery(run.query);
									setSelectedHistoryRunId(run.id);
								}}
								runs={history.data ?? []}
							/>
						</section>

						<EvidenceColumn citations={result?.citations ?? []} />
					</div>
				</section>
			</div>
		</main>
	);
}

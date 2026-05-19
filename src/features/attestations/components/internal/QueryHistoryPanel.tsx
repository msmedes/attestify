import { Clock3 } from "lucide-react";
import type { QueryRunSummary } from "../../types";

type QueryHistoryPanelProps = {
	runs: QueryRunSummary[];
	isLoading: boolean;
	activeRunId: string | null;
	onRunSelected: (run: QueryRunSummary) => void;
};

export function QueryHistoryPanel({
	activeRunId,
	runs,
	isLoading,
	onRunSelected,
}: QueryHistoryPanelProps) {
	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<div className="border-[#20211f] border-b p-4">
				<div className="flex items-center gap-2 text-[#3b6d65] text-sm">
					<Clock3 aria-hidden="true" size={16} />
					<span>History</span>
				</div>
			</div>

			<div className="max-h-[340px] overflow-y-auto">
				{isLoading ? (
					<output className="block p-4 text-[#686a64] text-sm">
						Loading previous runs...
					</output>
				) : null}

				{!isLoading && runs.length === 0 ? (
					<div className="p-4 text-[#686a64] text-sm">No saved runs yet.</div>
				) : null}

				{runs.map((run) => (
					<button
						aria-pressed={activeRunId === run.id}
						className={`block min-h-24 w-full border-[#d6d8cf] border-b p-4 text-left transition-colors transition-transform hover:bg-[#d8eee7] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-[-2px] ${
							activeRunId === run.id ? "bg-[#d8eee7]" : ""
						}`}
						key={run.id}
						onClick={() => onRunSelected(run)}
						type="button"
					>
						<div className="mb-2 font-medium text-sm leading-5">
							{run.query}
						</div>
						<div className="line-clamp-2 text-[#686a64] text-sm leading-5">
							{run.answerText || run.answerStatus}
						</div>
						<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[#3b6d65] text-xs">
							<span>{new Date(run.createdAt).toLocaleString()}</span>
							<span className="tabular-nums">
								{run.citationCount} citations
							</span>
							<span className="tabular-nums">
								{run.retrievalQueryCount} retrieval queries
							</span>
						</div>
					</button>
				))}
			</div>
		</section>
	);
}

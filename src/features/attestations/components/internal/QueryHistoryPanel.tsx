import { Clock3 } from "lucide-react";
import type { QueryRunSummary } from "../../types";

type QueryHistoryPanelProps = {
	runs: QueryRunSummary[];
	isLoading: boolean;
	onQuerySelected: (query: string) => void;
};

export function QueryHistoryPanel({
	runs,
	isLoading,
	onQuerySelected,
}: QueryHistoryPanelProps) {
	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<div className="border-[#20211f] border-b p-4">
				<div className="flex items-center gap-2 text-[#3b6d65] text-sm">
					<Clock3 aria-hidden="true" size={16} />
					<span>SQLite query history</span>
				</div>
			</div>

			<div className="max-h-[340px] overflow-y-auto">
				{isLoading ? (
					<div className="p-4 text-[#686a64]">Loading previous runs...</div>
				) : null}

				{!isLoading && runs.length === 0 ? (
					<div className="p-4 text-[#686a64]">No saved runs yet.</div>
				) : null}

				{runs.map((run) => (
					<button
						className="block w-full border-[#d6d8cf] border-b p-4 text-left transition hover:bg-[#d8eee7]"
						key={run.id}
						onClick={() => onQuerySelected(run.query)}
						type="button"
					>
						<div className="mb-2 font-medium text-sm">{run.query}</div>
						<div className="line-clamp-2 text-[#686a64] text-sm">
							{run.answerText || run.answerStatus}
						</div>
						<div className="mt-2 flex flex-wrap gap-3 text-[#3b6d65] text-xs">
							<span>{new Date(run.createdAt).toLocaleString()}</span>
							<span>{run.citationCount} citations</span>
							<span>{run.retrievalQueryCount} retrieval queries</span>
						</div>
					</button>
				))}
			</div>
		</section>
	);
}

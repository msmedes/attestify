import { Link } from "@tanstack/react-router";
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
					<div
						className={`border-[#d6d8cf] border-b transition-colors ${
							activeRunId === run.id ? "bg-[#d8eee7]" : "bg-[#ffffff]"
						}`}
						key={run.id}
					>
						<button
							aria-pressed={activeRunId === run.id}
							className="block min-h-24 w-full p-4 text-left transition-colors transition-transform hover:bg-[#d8eee7] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-[-2px]"
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
								<span>{run.queryMode}</span>
								<span className="tabular-nums">
									{run.citationCount} citations
								</span>
								<span className="tabular-nums">
									{run.retrievalQueryCount} retrieval queries
								</span>
								{run.claimVerification ? (
									<span className="tabular-nums">
										{run.claimVerification.supported} source-supported /{" "}
										{run.claimVerification.weak} weak /{" "}
										{run.claimVerification.contradicted +
											run.claimVerification.missing}{" "}
										needs review
									</span>
								) : null}
								{run.evidenceLoop ? (
									<span className="tabular-nums">
										loop {run.evidenceLoop.stopReason} /{" "}
										{run.evidenceLoop.iterations} iterations
									</span>
								) : null}
							</div>
						</button>
						<div className="flex justify-end px-4 pb-3">
							<Link
								className="inline-flex min-h-8 items-center border border-[#20211f] bg-[#ffffff] px-2 text-[#20211f] text-xs transition-colors hover:bg-[#f4f5ef] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-2"
								params={{ runId: run.id }}
								to="/queries/$runId"
							>
								Query page
							</Link>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

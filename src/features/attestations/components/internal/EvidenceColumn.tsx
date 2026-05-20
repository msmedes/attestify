import { Link2 } from "lucide-react";
import { citationDiagnosticState } from "../../citation-state";
import type { CitationUnit } from "../../types";
import { CitationCard } from "./CitationCard";

type EvidenceColumnProps = {
	citations: CitationUnit[];
};

export function EvidenceColumn({ citations }: EvidenceColumnProps) {
	const stateCounts = citations.reduce(
		(counts, citation) => {
			counts[citationDiagnosticState(citation).status] += 1;
			return counts;
		},
		{ resolved: 0, stale: 0, unresolved: 0 },
	);

	return (
		<aside className="border-[#20211f] border-t bg-[#eeeeea] xl:border-t-0 xl:border-l">
			<div className="sticky top-0 max-h-screen overflow-y-auto">
				<div className="flex items-center justify-between border-[#20211f] border-b bg-[#eeeeea] px-5 py-4">
					<div>
						<p className="text-[#6f716d] text-sm">Citation units</p>
						<h2 className="font-semibold text-xl">Attestations</h2>
					</div>
					<Link2 aria-hidden="true" className="text-[#3b6d65]" size={22} />
				</div>
				{citations.length > 0 ? (
					<div className="flex flex-wrap gap-2 border-[#20211f] border-b bg-[#f7f7f2] px-4 py-3 text-xs">
						<StateCount label="Resolved" value={stateCounts.resolved} />
						<StateCount label="Older snapshot" value={stateCounts.stale} />
						<StateCount label="Unresolved" value={stateCounts.unresolved} />
					</div>
				) : null}

				{citations.length > 0 ? (
					<div className="grid gap-3 p-4">
						{citations.map((citation) => (
							<CitationCard citation={citation} key={citation.citationHandle} />
						))}
					</div>
				) : (
					<div className="p-5 text-[#6f716d]">No citations yet.</div>
				)}
			</div>
		</aside>
	);
}

function StateCount({ label, value }: { label: string; value: number }) {
	return (
		<span className="border border-[#c9cac3] bg-[#ffffff] px-2 py-1 text-[#4a4c48]">
			{label}: <span className="font-semibold tabular-nums">{value}</span>
		</span>
	);
}

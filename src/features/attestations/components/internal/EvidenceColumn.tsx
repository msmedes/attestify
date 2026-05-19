import { Link2 } from "lucide-react";
import type { CitationUnit } from "../../types";
import { CitationCard } from "./CitationCard";

type EvidenceColumnProps = {
	citations: CitationUnit[];
};

export function EvidenceColumn({ citations }: EvidenceColumnProps) {
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

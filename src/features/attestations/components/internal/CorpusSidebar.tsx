import { BookOpen, Database, FileText, Network } from "lucide-react";
import corpusManifest from "../../generated/gutenberg-manifest.json";
import type { SearchResponse } from "../../types";
import type { CorpusView } from "./CorpusBrowser";

type CorpusSidebarProps = {
	activeView: CorpusView | null;
	onViewSelected: (view: CorpusView) => void;
	stats: SearchResponse["corpusStats"] | null;
};

export function CorpusSidebar({
	activeView,
	onViewSelected,
	stats,
}: CorpusSidebarProps) {
	const displayedStats = stats ?? corpusManifest.stats;

	return (
		<aside className="border-[#20211f] border-b bg-[#20211f] text-[#f7f7f2] xl:border-r xl:border-b-0">
			<div className="grid gap-6 p-5 md:grid-cols-2 xl:grid-cols-1 xl:p-6">
				<div>
					<div className="mb-5 flex h-10 w-10 items-center justify-center border border-[#f7f7f2] bg-[#c14f2f]">
						<Network aria-hidden="true" size={20} />
					</div>
					<h2 className="font-semibold text-2xl">Attestify</h2>
				</div>

				<div className="grid grid-cols-3 gap-2 xl:grid-cols-1">
					<Metric
						active={activeView?.type === "docs"}
						icon={<FileText aria-hidden="true" size={17} />}
						label="Docs"
						onClick={() => onViewSelected({ type: "docs" })}
						value={displayedStats.documents}
					/>
					<Metric
						active={activeView?.type === "spans"}
						icon={<BookOpen aria-hidden="true" size={17} />}
						label="Spans"
						onClick={() => onViewSelected({ type: "spans" })}
						value={displayedStats.spans}
					/>
					<Metric
						active={activeView?.type === "claims"}
						icon={<Database aria-hidden="true" size={17} />}
						label="Claims"
						onClick={() => onViewSelected({ type: "claims" })}
						value={displayedStats.attestations}
					/>
				</div>

				<div className="border border-[#6f716d] p-4 text-[#d8eee7] text-sm">
					<p className="mb-3 font-medium text-[#ffffff]">Seed sources</p>
					<ul className="space-y-2">
						{corpusManifest.sources.map((source) => (
							<li key={source.sourceId}>
								<button
									aria-pressed={
										activeView?.type === "source" &&
										activeView.sourceId === source.sourceId
									}
									className={`min-h-10 w-full text-left transition-colors hover:text-[#ffffff] focus-visible:outline-2 focus-visible:outline-[#d8eee7] focus-visible:outline-offset-2 ${
										activeView?.type === "source" &&
										activeView.sourceId === source.sourceId
											? "text-[#ffffff]"
											: ""
									}`}
									onClick={() =>
										onViewSelected({
											type: "source",
											sourceId: source.sourceId,
										})
									}
									type="button"
								>
									{source.title.replace(/, Act .+$/, "")}
								</button>
							</li>
						))}
					</ul>
				</div>
			</div>
		</aside>
	);
}

function Metric({
	active,
	icon,
	label,
	onClick,
	value,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	value: number;
}) {
	return (
		<button
			aria-pressed={active}
			className={`min-h-24 border p-3 text-left transition-colors transition-transform hover:border-[#f7f7f2] hover:bg-[#3b6d65] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[#d8eee7] focus-visible:outline-offset-2 ${
				active
					? "border-[#f7f7f2] bg-[#3b6d65]"
					: "border-[#6f716d] bg-[#2b2d2a]"
			}`}
			onClick={onClick}
			type="button"
		>
			<div className="mb-2 flex items-center gap-2 text-[#d8eee7] text-xs">
				{icon}
				<span>{label}</span>
			</div>
			<div className="font-semibold text-2xl tabular-nums">{value}</div>
		</button>
	);
}

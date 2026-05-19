import { Layers3 } from "lucide-react";
import type { RetrievalChunk } from "../../types";

type RawChunkPanelProps = {
	chunks: RetrievalChunk[];
};

export function RawChunkPanel({ chunks }: RawChunkPanelProps) {
	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<div className="flex items-center justify-between border-[#20211f] border-b px-4 py-3">
				<div>
					<p className="text-[#6f716d] text-sm">RAG candidate spans</p>
					<h2 className="font-semibold text-xl">Retrieved chunks</h2>
				</div>
				<Layers3 aria-hidden="true" className="text-[#c14f2f]" size={22} />
			</div>

			<div className="divide-y divide-[#d7d8d1]">
				{chunks.map((chunk) => (
					<article className="grid gap-2 px-4 py-4" key={chunk.spanId}>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
							<strong className="leading-5">{chunk.title}</strong>
							<span className="text-[#6f716d] leading-5">{chunk.section}</span>
							<span className="text-[#3b6d65] tabular-nums">
								score {chunk.score.toFixed(3)}
							</span>
						</div>
						<p className="max-w-[88ch] text-[#383a36] leading-7">
							{chunk.text}
						</p>
					</article>
				))}
			</div>
		</section>
	);
}

import { Braces } from "lucide-react";
import type { AiAnswer, AiTrace, AiTraceStep } from "../../types";

type AnswerPanelProps = {
	aiAnswer?: AiAnswer;
	aiTrace?: AiTrace;
	query: string;
	lines: string[];
	retrievalQueries: string[];
};

export function AnswerPanel({
	aiAnswer,
	aiTrace,
	lines,
	query,
	retrievalQueries,
}: AnswerPanelProps) {
	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<div className="flex items-center justify-between border-[#20211f] border-b px-4 py-3">
				<div>
					<p className="text-[#6f716d] text-sm">AI answer</p>
					<h2 className="font-semibold text-xl">{query}</h2>
				</div>
				<Braces aria-hidden="true" className="text-[#c14f2f]" size={22} />
			</div>

			<div className="px-4 py-4 text-lg leading-8">
				{retrievalQueries.length > 1 ? (
					<div className="mb-4 flex flex-wrap gap-2 border-[#d7d8d1] border-b pb-4 text-sm leading-5">
						<span className="text-[#6f716d]">retrieval plan</span>
						{retrievalQueries.map((retrievalQuery) => (
							<span
								className="border border-[#c9cac3] bg-[#f4f5ef] px-2 py-1 text-[#20211f]"
								key={retrievalQuery}
							>
								{retrievalQuery}
							</span>
						))}
					</div>
				) : null}

				{aiAnswer?.status === "ready" ? (
					<p>
						{aiAnswer.segments.map((segment) =>
							segment.type === "text" ? (
								<span key={`text:${segment.text}`}>{segment.text}</span>
							) : (
								<CitationMarker
									citedText={segment.text}
									citationNumber={segment.citationNumber}
									key={`citation:${segment.citationHandle}:${segment.text ?? ""}`}
									quote={segment.quote}
									sourceText={segment.sourceText}
									title={`${segment.sourceTitle}, ${segment.section}, ${segment.locator}`}
									to={`#${citationElementId(segment.citationHandle)}`}
								/>
							),
						)}
					</p>
				) : null}

				{aiAnswer?.status === "unavailable" ? (
					<div className="border border-[#c9cac3] bg-[#fffaf2] p-3 text-[#6f716d] text-sm">
						{aiAnswer.message}
					</div>
				) : null}

				{!aiAnswer ? (
					<div className="divide-y divide-[#d7d8d1]">
						{lines.map((line) => (
							<p className="py-4" key={line}>
								{line}
							</p>
						))}
					</div>
				) : null}

				{aiTrace ? <AiTracePanel trace={aiTrace} /> : null}
			</div>
		</section>
	);
}

function AiTracePanel({ trace }: { trace: AiTrace }) {
	return (
		<div className="mt-5 border-[#d7d8d1] border-t pt-4 text-sm leading-5">
			<p className="mb-2 font-semibold text-[#20211f]">AI trace</p>
			<div className="grid gap-2">
				{trace.steps.map((step, index) => (
					<TraceStepCard index={index} key={traceStepKey(step)} step={step} />
				))}
			</div>
		</div>
	);
}

function traceStepKey(step: AiTraceStep): string {
	if ("durationMs" in step) {
		return `${step.stage}:${step.status}:${step.durationMs}`;
	}

	if ("error" in step) {
		return `${step.stage}:${step.status}:${step.error}`;
	}

	return `${step.stage}:${step.status}`;
}

function TraceStepCard({ index, step }: { index: number; step: AiTraceStep }) {
	return (
		<details className="border border-[#c9cac3] bg-[#fbfcf7] p-3">
			<summary className="cursor-pointer font-medium text-[#20211f]">
				{index + 1}. {step.stage} · {step.status}
				{"durationMs" in step ? ` · ${step.durationMs}ms` : ""}
			</summary>
			<div className="mt-3 grid gap-2 text-[#4a4c48]">
				{"model" in step ? <TraceRow label="model" value={step.model} /> : null}
				{"input" in step ? (
					<TraceJson label="input" value={step.input} />
				) : null}
				{"output" in step ? (
					<TraceJson label="output" value={step.output} />
				) : null}
				{"error" in step ? <TraceRow label="error" value={step.error} /> : null}
			</div>
		</details>
	);
}

function TraceRow({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span className="font-medium text-[#20211f]">{label}: </span>
			<span>{value}</span>
		</div>
	);
}

function TraceJson({ label, value }: { label: string; value: unknown }) {
	return (
		<div>
			<p className="font-medium text-[#20211f]">{label}</p>
			<pre className="mt-1 max-h-56 whitespace-pre-wrap break-words border border-[#d7d8d1] bg-[#ffffff] p-2 text-xs leading-5">
				{JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}

function citationElementId(citationHandle: string): string {
	return `citation-${citationHandle.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function CitationMarker({
	citedText,
	citationNumber,
	quote,
	sourceText,
	title,
	to,
}: {
	citedText?: string;
	citationNumber: number;
	quote: string;
	sourceText: string;
	title: string;
	to: string;
}) {
	return (
		<span className="group relative inline break-words">
			{citedText ? <span>{citedText}</span> : null}
			<a
				aria-label={`Show citation: ${title}`}
				className="mx-1 inline-flex h-6 min-w-6 items-center justify-center border border-[#3b6d65] bg-[#d8eee7] px-1 align-baseline font-semibold text-[#2f5c55] text-xs tabular-nums no-underline"
				href={to}
			>
				{citationNumber}
			</a>
			<span className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-3 w-[min(520px,calc(100vw-48px))] border border-[#20211f] bg-[#ffffff] p-3 text-[#20211f] text-sm leading-6 opacity-0 shadow-[6px_6px_0_#20211f] transition group-hover:visible group-hover:opacity-100">
				<span className="mb-2 block font-semibold text-[#3b6d65]">{title}</span>
				<span className="mb-2 block border-[#c14f2f] border-l-4 bg-[#fffaf2] p-2">
					{quote}
				</span>
				<span className="block">{sourceText}</span>
			</span>
		</span>
	);
}

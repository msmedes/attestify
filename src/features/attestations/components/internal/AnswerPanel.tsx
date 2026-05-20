import { Braces } from "lucide-react";
import type {
	AiAnswer,
	AiTrace,
	AiTraceStep,
	AiTraceTimingSpan,
} from "../../types";
import { citationElementId } from "./citation-dom";

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
				<div className="min-w-0">
					<p className="text-[#6f716d] text-sm">AI answer</p>
					<h2 className="break-words font-semibold text-xl leading-tight">
						{query}
					</h2>
				</div>
				<Braces
					aria-hidden="true"
					className="ml-4 shrink-0 text-[#c14f2f]"
					size={22}
				/>
			</div>

			<div className="px-4 py-4 text-lg leading-8">
				{retrievalQueries.length > 1 ? (
					<div className="mb-4 flex flex-wrap gap-2 border-[#d7d8d1] border-b pb-4 text-sm leading-5">
						<span className="text-[#6f716d]">retrieval plan</span>
						{retrievalQueries.map((retrievalQuery) => (
							<span
								className="max-w-full break-words border border-[#c9cac3] bg-[#f4f5ef] px-2 py-1 text-[#20211f]"
								key={retrievalQuery}
							>
								{retrievalQuery}
							</span>
						))}
					</div>
				) : null}

				{aiAnswer?.status === "ready" ? (
					<>
						<p className="max-w-[72ch]">
							{aiAnswer.segments.map((segment) =>
								segment.type === "text" ? (
									<span key={`text:${segment.text}`}>{segment.text}</span>
								) : (
									<CitationMarker
										citedText={segment.text}
										citationNumber={segment.citationNumber}
										key={`citation:${segment.citationHandle}:${segment.citationNumber}:${segment.text ?? ""}`}
										quote={segment.quote}
										sourceText={segment.sourceText}
										title={`${segment.sourceTitle}, ${segment.section}, ${segment.locator}`}
										to={`#${citationElementId(segment.citationHandle)}`}
									/>
								),
							)}
						</p>
						{aiAnswer.claims?.length ? (
							<ClaimVerificationPanel claims={aiAnswer.claims} />
						) : null}
					</>
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
			{trace.timing ? <TraceWaterfall trace={trace} /> : null}
			<div className="grid gap-2">
				{trace.steps.map((step, index) => (
					<TraceStepCard index={index} key={JSON.stringify(step)} step={step} />
				))}
			</div>
		</div>
	);
}

function TraceWaterfall({ trace }: { trace: AiTrace }) {
	if (!trace.timing) {
		return null;
	}

	const spans = trace.timing.spans.filter((span) => span.durationMs >= 0);

	return (
		<div className="mb-3 border border-[#c9cac3] bg-[#fbfcf7] p-3">
			<div className="grid gap-2 sm:grid-cols-3">
				<TraceMetric label="total" value={`${trace.timing.totalMs}ms`} />
				<TraceMetric
					label="model provider"
					value={`${trace.timing.modelProviderMs}ms`}
				/>
				<TraceMetric
					label="application"
					value={`${trace.timing.applicationMs}ms`}
				/>
			</div>
			<div className="mt-3 grid gap-2">
				{spans.map((span) => (
					<TraceWaterfallRow
						key={`${span.stage}:${span.label}:${span.category}:${span.durationMs}:${span.model ?? ""}:${span.count ?? ""}`}
						span={span}
						totalMs={trace.timing?.totalMs ?? 0}
					/>
				))}
			</div>
		</div>
	);
}

function TraceMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="border border-[#d7d8d1] bg-[#ffffff] px-3 py-2">
			<p className="text-[#6f716d] text-xs">{label}</p>
			<p className="font-semibold text-[#20211f] tabular-nums">{value}</p>
		</div>
	);
}

function TraceWaterfallRow({
	span,
	totalMs,
}: {
	span: AiTraceTimingSpan;
	totalMs: number;
}) {
	const width = `${Math.max(2, Math.round((span.durationMs / Math.max(totalMs, 1)) * 100))}%`;
	const barClassName =
		span.category === "model-provider" ? "bg-[#c14f2f]" : "bg-[#3b6d65]";
	const detail = [
		span.model,
		typeof span.count === "number" ? `${span.count} items` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div>
			<div className="mb-1 flex items-baseline justify-between gap-3">
				<p className="min-w-0 truncate text-[#20211f]">
					{span.stage} · {span.label}
				</p>
				<p className="shrink-0 text-[#4a4c48] tabular-nums">
					{span.durationMs}ms
				</p>
			</div>
			<div className="h-2 border border-[#d7d8d1] bg-[#ffffff]">
				<div className={`h-full ${barClassName}`} style={{ width }} />
			</div>
			{detail ? <p className="mt-1 text-[#6f716d] text-xs">{detail}</p> : null}
		</div>
	);
}

type VerifiedClaim = NonNullable<
	Extract<AiAnswer, { status: "ready" }>["claims"]
>[number];

const claimStatusUi: Record<
	VerifiedClaim["verification"]["status"],
	{ className: string; label: string }
> = {
	supported: {
		className: "border-[#3b6d65] bg-[#d8eee7] text-[#2f5c55]",
		label: "supported",
	},
	weak: {
		className: "border-[#a16c1b] bg-[#fff4d6] text-[#7a5013]",
		label: "weak support",
	},
	contradicted: {
		className: "border-[#9f3325] bg-[#ffe1dc] text-[#7f291e]",
		label: "contradicted",
	},
	missing: {
		className: "border-[#6f716d] bg-[#efefea] text-[#4a4c48]",
		label: "missing support",
	},
};

function ClaimVerificationPanel({ claims }: { claims: VerifiedClaim[] }) {
	return (
		<div className="mt-5 border-[#d7d8d1] border-t pt-4 text-sm leading-5">
			<p className="mb-2 font-semibold text-[#20211f]">
				Claim evidence support
			</p>
			<div className="grid gap-2">
				{claims.map((claim) => (
					<ClaimVerificationCard
						claim={claim}
						key={`${claim.verification.status}:${claim.text}`}
					/>
				))}
			</div>
		</div>
	);
}

function ClaimVerificationCard({ claim }: { claim: VerifiedClaim }) {
	const status = claimStatusUi[claim.verification.status];

	return (
		<div className="border border-[#c9cac3] bg-[#fbfcf7] p-3">
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<span
					className={`border px-2 py-1 font-semibold text-xs ${status.className}`}
				>
					{status.label}
				</span>
				<span className="text-[#6f716d] text-xs">
					source evidence support, not world-truth verification
				</span>
			</div>
			<p className="text-[#20211f]">{claim.text}</p>
			<p className="mt-2 text-[#4a4c48]">{claim.verification.rationale}</p>
			<div className="mt-2 flex flex-wrap gap-2 text-xs">
				{claim.verification.evidence.map((evidence) => (
					<span
						className="border border-[#d7d8d1] bg-[#ffffff] px-2 py-1 text-[#3b6d65]"
						key={evidence.citationHandle}
					>
						{evidence.citationHandle}
					</span>
				))}
			</div>
		</div>
	);
}

function TraceStepCard({ index, step }: { index: number; step: AiTraceStep }) {
	return (
		<details className="group border border-[#c9cac3] bg-[#fbfcf7]">
			<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-[#20211f] transition-colors hover:bg-[#f4f5ef] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-[-2px]">
				<span className="inline-block text-[#3b6d65] transition-transform group-open:rotate-90">
					▸
				</span>
				<span>
					{index + 1}. {step.stage} · {step.status}
					{"durationMs" in step ? ` · ${step.durationMs}ms` : ""}
				</span>
			</summary>
			<div className="grid gap-2 border-[#d7d8d1] border-t p-3 text-[#4a4c48]">
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
			<pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words border border-[#d7d8d1] bg-[#ffffff] p-2 font-mono text-[11px] leading-5">
				{JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
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
				className="mx-1 inline-flex h-7 min-w-7 items-center justify-center border border-[#3b6d65] bg-[#d8eee7] px-1 align-baseline font-semibold text-[#2f5c55] text-xs tabular-nums no-underline transition-colors transition-transform hover:bg-[#c2e4dc] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-2"
				href={to}
			>
				{citationNumber}
			</a>
			<span className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-3 max-h-[420px] w-[min(520px,calc(100vw-48px))] overflow-auto border border-[#20211f] bg-[#ffffff] p-3 text-[#20211f] text-sm leading-6 opacity-0 shadow-[6px_6px_0_#20211f] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
				<span className="mb-2 block font-semibold text-[#3b6d65]">{title}</span>
				<span className="mb-2 block border-[#c14f2f] border-l-4 bg-[#fffaf2] p-2">
					{quote}
				</span>
				<span className="block">{sourceText}</span>
			</span>
		</span>
	);
}

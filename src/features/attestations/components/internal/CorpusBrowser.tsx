import { useQuery } from "@tanstack/react-query";
import { BookOpen, Database, FileText } from "lucide-react";
import {
	type CorpusBrowserView,
	fetchCorpusBrowserView,
} from "../../corpus-browser-api";
import type { Attestation, SourceDocument, SourceSpan } from "../../types";

export type CorpusView = CorpusBrowserView;

export function CorpusBrowser({ view }: { view: CorpusView }) {
	const corpus = useQuery({
		queryKey: ["corpus-browser", view],
		queryFn: () => fetchCorpusBrowserView(view),
	});

	return (
		<section className="border border-[#20211f] bg-[#ffffff]">
			<header className="flex items-center justify-between border-[#20211f] border-b px-4 py-3">
				<div>
					<p className="text-[#6f716d] text-sm">Generated corpus</p>
					<h2 className="font-semibold text-xl">{titleForView(view)}</h2>
				</div>
				{iconForView(view)}
			</header>

			<div className="max-h-[560px] overflow-y-auto p-4">
				{corpus.isPending ? (
					<div className="text-[#6f716d] text-sm">Loading corpus view...</div>
				) : null}

				{corpus.isError ? (
					<div className="border border-[#9f2f2f] bg-[#fff7f4] p-3 text-[#7a2424]">
						{corpus.error.message}
					</div>
				) : null}

				{corpus.data?.type === "docs" ? (
					<div className="grid gap-3 md:grid-cols-2">
						{corpus.data.manifest.sources.map((source) => (
							<SourceSummary key={source.sourceId} source={source} />
						))}
					</div>
				) : null}

				{corpus.data?.type === "spans" ? (
					<div className="grid gap-3">
						<ResultCount
							shown={corpus.data.spans.length}
							total={corpus.data.total}
						/>
						{corpus.data.spans.map((span) => (
							<SpanItem key={span.spanId} span={span} />
						))}
					</div>
				) : null}

				{corpus.data?.type === "claims" ? (
					<div className="grid gap-3">
						<ResultCount
							shown={corpus.data.claims.length}
							total={corpus.data.total}
						/>
						{corpus.data.claims.map((claim) => (
							<ClaimItem
								attestation={claim.attestation}
								key={claim.attestation.id}
								sourceTitle={claim.source.title}
								span={claim.span}
							/>
						))}
					</div>
				) : null}

				{corpus.data?.type === "source" ? (
					<SourceDetail source={corpus.data.source} />
				) : null}
			</div>
		</section>
	);
}

function SourceSummary({
	source,
}: {
	source: {
		title: string;
		attribution: string;
		sourceUrl?: string;
		spans: number;
		attestations: number;
	};
}) {
	return (
		<article className="border border-[#20211f] bg-[#f7f7f2] p-3">
			<div className="mb-2 flex items-start justify-between gap-3">
				<h3 className="font-semibold leading-tight">{source.title}</h3>
				<span className="text-[#6f716d] text-xs tabular-nums">
					{source.spans} spans
				</span>
			</div>
			<p className="text-[#6f716d] text-sm">{source.attribution}</p>
			<p className="mt-2 text-[#3b6d65] text-sm">
				{source.attestations} generated claims
			</p>
			{source.sourceUrl ? (
				<a
					className="mt-2 block break-all text-[#6f716d] text-xs underline"
					href={source.sourceUrl}
				>
					{source.sourceUrl}
				</a>
			) : null}
		</article>
	);
}

function SourceDetail({ source }: { source: SourceDocument | null }) {
	if (!source) {
		return <div className="text-[#6f716d]">Source not found.</div>;
	}

	return (
		<div className="grid gap-3">
			<SourceSummary
				source={{
					title: source.title,
					attribution: source.attribution,
					sourceUrl: source.sourceUrl,
					spans: source.spans.length,
					attestations: source.spans.reduce(
						(count, span) => count + span.attestations.length,
						0,
					),
				}}
			/>
			{source.spans.map((span) => (
				<SpanItem key={span.spanId} span={span} sourceTitle={source.title} />
			))}
		</div>
	);
}

function SpanItem({
	sourceTitle,
	span,
}: {
	sourceTitle?: string;
	span: SourceSpan;
}) {
	return (
		<article className="border border-[#20211f] bg-[#f7f7f2]">
			<div className="border-[#20211f] border-b p-3">
				<div className="mb-2 flex flex-wrap items-center gap-2 text-[#6f716d] text-xs">
					<code className="break-all">{span.spanId}</code>
					{sourceTitle ? <span>{sourceTitle}</span> : null}
					<span>{span.locator}</span>
				</div>
				<p className="max-w-[90ch] font-medium leading-7">{span.text}</p>
			</div>
			<div className="grid gap-2 p-3">
				{span.attestations.map((attestation) => (
					<ClaimItem
						attestation={attestation}
						key={attestation.id}
						sourceTitle={sourceTitle}
						span={span}
					/>
				))}
			</div>
		</article>
	);
}

function ClaimItem({
	attestation,
	sourceTitle,
	span,
}: {
	attestation: Attestation;
	sourceTitle?: string;
	span: SourceSpan;
}) {
	return (
		<article className="border border-[#c9cac3] bg-[#ffffff] p-3">
			<div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
				<code className="break-all bg-[#eeeeea] px-1 py-0.5 text-[#3b6d65]">
					{attestation.id}#{span.spanId}
				</code>
				<span className="text-[#6f716d]">{attestation.type}</span>
				{sourceTitle ? (
					<span className="text-[#6f716d]">{sourceTitle}</span>
				) : null}
			</div>
			<p className="text-sm leading-5">
				<span className="font-semibold">{attestation.subject}</span>{" "}
				{attestation.predicate} {attestation.value}
			</p>
			<blockquote className="mt-2 border-[#c14f2f] border-l-4 bg-[#fffaf2] p-2 text-sm leading-6">
				{attestation.anchorText}
			</blockquote>
		</article>
	);
}

function ResultCount({ shown, total }: { shown: number; total: number }) {
	return (
		<div className="border border-[#c9cac3] bg-[#eeeeea] p-3 text-[#6f716d] text-sm tabular-nums">
			Showing {shown} of {total}.
		</div>
	);
}

function titleForView(view: CorpusView): string {
	if (view.type === "docs") {
		return "Documents";
	}

	if (view.type === "spans") {
		return "Spans";
	}

	if (view.type === "claims") {
		return "Claims";
	}

	return "Source";
}

function iconForView(view: CorpusView) {
	const className = "text-[#3b6d65]";

	if (view.type === "docs" || view.type === "source") {
		return <FileText aria-hidden="true" className={className} size={22} />;
	}

	if (view.type === "spans") {
		return <BookOpen aria-hidden="true" className={className} size={22} />;
	}

	return <Database aria-hidden="true" className={className} size={22} />;
}

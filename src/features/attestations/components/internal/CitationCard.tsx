import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { citationDiagnosticState } from "../../citation-state";
import type { CitationUnit } from "../../types";

type CitationCardProps = {
	citation: CitationUnit;
};

export function CitationCard({ citation }: CitationCardProps) {
	const {
		attestation,
		citationIdentity,
		historyEvidence,
		source,
		span,
		support,
	} = citation;
	const isUnresolvedHistoryEvidence = historyEvidence?.status === "unresolved";
	const diagnosticState = citationDiagnosticState(citation);

	return (
		<article
			className={`scroll-mt-4 border bg-[#ffffff] transition-shadow target:shadow-[6px_6px_0_#c14f2f] ${cardBorderClass(diagnosticState.status)}`}
			id={citationElementId(citation.citationHandle)}
		>
			<div className="border-[#20211f] border-b p-3">
				<div className="mb-2 flex items-start justify-between gap-3">
					<span className="bg-[#f7f7f2] px-1 py-0.5 font-semibold text-[#3b6d65] text-xs leading-5">
						{citation.citationLabel}
					</span>
					<span className="text-[#6f716d] text-xs tabular-nums">
						{citation.score.toFixed(3)}
					</span>
				</div>
				<div
					className={`mb-2 inline-flex border px-2 py-1 text-xs ${stateBadgeClass(diagnosticState.status)}`}
				>
					{diagnosticState.label}
				</div>
				<h3 className="font-semibold leading-tight">{attestation.subject}</h3>
				<p className="mt-1 text-[#20211f] text-sm leading-5">
					{attestation.predicate}: {attestation.value}
				</p>
			</div>

			<div className="grid gap-3 p-3 text-sm">
				<div
					className={`flex items-center gap-2 leading-5 ${verificationClass(diagnosticState.status)}`}
				>
					{diagnosticState.status === "unresolved" ? (
						<AlertTriangle aria-hidden="true" className="shrink-0" size={16} />
					) : (
						<CheckCircle2 aria-hidden="true" className="shrink-0" size={16} />
					)}
					<span>
						{diagnosticState.status === "unresolved"
							? diagnosticState.description
							: support.verifiedAgainstSource
								? `${support.method}; ${diagnosticState.description}`
								: "not verified"}
					</span>
				</div>

				{isUnresolvedHistoryEvidence ? (
					<div className="border border-[#9f2f2f] bg-[#fff7f4] p-3 text-[#7a2424] leading-6">
						Citation evidence is unresolved for this saved run.
					</div>
				) : (
					<blockquote className="border-[#c14f2f] border-l-4 bg-[#fffaf2] p-3 leading-6">
						{historyEvidence?.status === "persisted"
							? historyEvidence.quote
							: attestation.anchorText}
					</blockquote>
				)}

				<div className="flex items-start gap-2 text-[#6f716d] leading-5">
					<FileText aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
					<span>
						{historyEvidence?.status === "persisted"
							? `${historyEvidence.sourceTitle}, ${historyEvidence.section}, ${historyEvidence.locator}`
							: `${source.title}, ${span.section}, ${span.locator}`}
					</span>
				</div>

				<details className="text-[#6f716d] text-xs">
					<summary className="cursor-pointer text-[#3b6d65]">
						Citation provenance
					</summary>
					<code className="mt-2 block break-all bg-[#f7f7f2] p-2 leading-5">
						{citationIdentity.status === "resolvable"
							? `${citationIdentity.connectorId}:${citationIdentity.externalSourceId}:${citationIdentity.sourceSnapshot.version ?? citationIdentity.sourceSnapshot.contentHash}:${citationIdentity.span.locator}`
							: citation.citationHandle}
					</code>
				</details>
			</div>
		</article>
	);
}

function citationElementId(citationHandle: string): string {
	return `citation-${citationHandle.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function cardBorderClass(status: "resolved" | "stale" | "unresolved"): string {
	if (status === "unresolved") {
		return "border-[#9f2f2f]";
	}

	if (status === "stale") {
		return "border-[#9b6a20]";
	}

	return "border-[#20211f]";
}

function stateBadgeClass(status: "resolved" | "stale" | "unresolved"): string {
	if (status === "unresolved") {
		return "border-[#9f2f2f] bg-[#fff7f4] text-[#7a2424]";
	}

	if (status === "stale") {
		return "border-[#9b6a20] bg-[#fffaf2] text-[#725018]";
	}

	return "border-[#3b6d65] bg-[#eef8f4] text-[#2f5c55]";
}

function verificationClass(
	status: "resolved" | "stale" | "unresolved",
): string {
	if (status === "unresolved") {
		return "text-[#7a2424]";
	}

	if (status === "stale") {
		return "text-[#725018]";
	}

	return "text-[#3b6d65]";
}

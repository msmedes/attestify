import generatedCorpus from "./generated/gutenberg-corpus.json";
import type { SourceDocument, SourceSpan } from "./types";

export const corpus: SourceDocument[] = generatedCorpus as SourceDocument[];

export function listSpans(): SourceSpan[] {
	return corpus.flatMap((source) => source.spans);
}

export function findSource(sourceId: string): SourceDocument | undefined {
	return corpus.find((source) => source.sourceId === sourceId);
}

export function findSpan(spanId: string): SourceSpan | undefined {
	return listSpans().find((span) => span.spanId === spanId);
}

export function getCorpusStats() {
	const spans = listSpans();

	return {
		documents: corpus.length,
		spans: spans.length,
		attestations: spans.reduce(
			(count, span) => count + span.attestations.length,
			0,
		),
	};
}

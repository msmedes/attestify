import {
	createAttestationCandidate,
	createExtractionRun,
	createSourceSnapshot,
	createSourceSpanCandidate,
	verifyAttestationCandidate,
} from "./ingestion";
import type {
	Attestation,
	SourceDocument,
	SourceKind,
	SourceSpan,
} from "./types";

export type GutenbergSourceInput = {
	gutenbergId: number;
	sourceId: string;
	title: string;
	kind: SourceKind;
	body: string;
	sourceUrl: string;
	updatedAt: string;
	maxSpans: number;
};

type SegmentedSpan = {
	compatibilitySpanId: string;
	section: string;
	locator: string;
	text: string;
	sourceOffset: number;
};

const EXTRACTOR_ID = "gutenberg-fixture-import";
const EXTRACTOR_VERSION = "1.0.0";
const MIN_PARAGRAPH_CHARS = 50;
const MAX_PARAGRAPH_CHARS = 1400;

export function buildGutenbergSourceDocument({
	body,
	gutenbergId,
	kind,
	maxSpans,
	sourceId,
	sourceUrl,
	title,
	updatedAt,
}: GutenbergSourceInput): SourceDocument {
	const content = normalizeCorpusBody(body);
	const segmentedSpans = segmentText({
		sourceId,
		text: content,
		title,
	}).slice(0, maxSpans);
	const attribution = `Project Gutenberg eBook #${gutenbergId}`;
	const snapshot = createSourceSnapshot({
		connectorId: "project-gutenberg",
		externalSourceId: String(gutenbergId),
		kind,
		title,
		content,
		attribution,
		updatedAt,
		sourceUrl,
		snapshotVersion: `gutenberg-${gutenbergId}-utf8`,
	});
	const extractionRun = createExtractionRun({
		snapshot,
		extractorId: EXTRACTOR_ID,
		extractorVersion: EXTRACTOR_VERSION,
		startedAt: `${updatedAt}T00:00:00.000Z`,
	});
	const spans = segmentedSpans.map((span) => {
		const spanCandidate = createSourceSpanCandidate({
			snapshot,
			spanKey: span.compatibilitySpanId,
			section: span.section,
			locator: span.locator,
			text: span.text,
			sourceOffset: span.sourceOffset,
		});

		return {
			spanId: span.compatibilitySpanId,
			sourceId,
			section: span.section,
			locator: span.locator,
			text: span.text,
			ingestion: {
				spanId: spanCandidate.spanId,
			},
			attestations: buildAttestations({
				extractionRun,
				section: span.section,
				sourceTitle: title,
				span: spanCandidate,
				compatibilitySpanId: span.compatibilitySpanId,
			}),
		} satisfies SourceSpan;
	});

	return {
		sourceId,
		kind,
		title,
		attribution,
		updatedAt,
		sourceUrl,
		ingestion: {
			connectorId: snapshot.connectorId,
			externalSourceId: snapshot.externalSourceId,
			sourceId: snapshot.sourceId,
			snapshotId: snapshot.snapshotId,
			snapshotVersion: snapshot.snapshotVersion,
			contentHash: snapshot.contentHash,
			extractionRunId: extractionRun.extractionRunId,
			extractorVersion: extractionRun.extractorVersion,
			verifiedAt: extractionRun.startedAt,
		},
		spans,
	};
}

function segmentText({
	sourceId,
	text,
}: {
	sourceId: string;
	text: string;
	title: string;
}): SegmentedSpan[] {
	const spans: SegmentedSpan[] = [];
	let section = "Front matter";
	let paragraphIndex = 0;
	let searchOffset = 0;
	const paragraphs = text.split(/\n{2,}/);

	for (const rawParagraph of paragraphs) {
		const paragraph = rawParagraph.trim();

		if (!paragraph) {
			continue;
		}

		const heading = parseHeading(paragraph);

		if (heading) {
			section = heading;
			continue;
		}

		if (
			paragraph.length < MIN_PARAGRAPH_CHARS ||
			paragraph.startsWith("[") ||
			paragraph.startsWith("Illustration")
		) {
			continue;
		}

		for (const chunk of splitLongParagraph(paragraph)) {
			const sourceOffset = findSourceOffset(text, chunk, searchOffset);

			if (sourceOffset < 0) {
				throw new Error(
					`Generated span was not found in source text: ${chunk.slice(0, 120)}`,
				);
			}

			searchOffset = sourceOffset + chunk.length;
			paragraphIndex += 1;
			const compatibilitySpanId = `${sourceId}-${String(
				paragraphIndex,
			).padStart(5, "0")}`;

			spans.push({
				compatibilitySpanId,
				section,
				locator: `paragraph ${paragraphIndex}`,
				text: chunk,
				sourceOffset,
			});
		}
	}

	return spans;
}

function findSourceOffset(
	text: string,
	chunk: string,
	searchOffset: number,
): number {
	const afterPreviousChunk = text.indexOf(chunk, searchOffset);

	if (afterPreviousChunk >= 0) {
		return afterPreviousChunk;
	}

	return text.indexOf(chunk);
}

function buildAttestations({
	compatibilitySpanId,
	extractionRun,
	section,
	sourceTitle,
	span,
}: {
	compatibilitySpanId: string;
	extractionRun: ReturnType<typeof createExtractionRun>;
	section: string;
	sourceTitle: string;
	span: ReturnType<typeof createSourceSpanCandidate>;
}): Attestation[] {
	const sentences = splitSentences(span.text)
		.filter((sentence) => sentence.length >= 30)
		.slice(0, 3);
	const candidateInputs =
		sentences.length > 0
			? sentences.map((sentence, index) => ({
					compatibilityId: `att:${compatibilitySpanId}:sentence-${index + 1}`,
					predicate: "states",
					value: sentence,
					anchorText: sentence,
				}))
			: [
					{
						compatibilityId: `att:${compatibilitySpanId}:passage`,
						predicate: "contains passage",
						value: span.text,
						anchorText: span.text,
					},
				];

	return candidateInputs.map((input) => {
		const candidate = createAttestationCandidate({
			extractionRun,
			span,
			type: "passage",
			subject: sourceTitle,
			predicate: input.predicate,
			value: input.value,
			context: section,
			anchorText: input.anchorText,
		});
		const verified = verifyAttestationCandidate({
			candidate,
			span,
			verifiedAt: `${extractionRun.startedAt}`,
		});

		return {
			id: input.compatibilityId,
			type: "passage",
			subject: verified.subject,
			predicate: verified.predicate,
			value: verified.value,
			context: verified.context,
			anchorText: verified.anchorText,
			ingestion: {
				status: "verified",
				method: verified.support.method,
			},
		} satisfies Attestation;
	});
}

function normalizeCorpusBody(text: string): string {
	return text
		.split(/\n{2,}/)
		.map(normalizeParagraph)
		.filter(Boolean)
		.join("\n\n");
}

function parseHeading(paragraph: string): string | null {
	const compact = paragraph.replace(/\s+/g, " ").trim();

	if (
		/^(ACT|SCENE|CHAPTER|PART|BOOK)\s+([IVXLC]+|\d+)/i.test(compact) ||
		/^[IVXLC]+\.\s+[A-Z]/.test(compact)
	) {
		return compact.slice(0, 120);
	}

	return null;
}

function splitLongParagraph(paragraph: string): string[] {
	if (paragraph.length <= MAX_PARAGRAPH_CHARS) {
		return [paragraph];
	}

	const chunks = [];
	let chunkStart = 0;
	const matches = [...paragraph.matchAll(/[^.!?]+[.!?]+(?:["”’])?/g)];

	for (const match of matches) {
		if (typeof match.index !== "number") {
			continue;
		}

		const sentenceEnd = match.index + match[0].length;
		const candidate = paragraph.slice(chunkStart, sentenceEnd).trim();

		if (candidate.length > MAX_PARAGRAPH_CHARS && match.index > chunkStart) {
			chunks.push(paragraph.slice(chunkStart, match.index).trim());
			chunkStart = match.index;
		}
	}

	const finalChunk = paragraph.slice(chunkStart).trim();

	if (finalChunk) {
		chunks.push(finalChunk);
	}

	return chunks.length > 0 ? chunks : [paragraph];
}

function splitSentences(text: string): string[] {
	return (
		text
			.match(/[^.!?]+[.!?]+(?:["”’])?/g)
			?.map((sentence) => sentence.trim())
			.filter(Boolean) ?? [text.trim()]
	);
}

function normalizeParagraph(paragraph: string): string {
	return paragraph
		.replace(/\s+/g, " ")
		.replace(/\[_.*?_\]/g, "")
		.trim();
}

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
	const segmentedSpans = segmentText({
		sourceId,
		text: normalizeCorpusBody(body),
		title,
	}).slice(0, maxSpans);
	const content = segmentedSpans.map((span) => span.text).join("\n\n");
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
			paragraphIndex += 1;
			const compatibilitySpanId = `${sourceId}-${String(
				paragraphIndex,
			).padStart(5, "0")}`;

			spans.push({
				compatibilitySpanId,
				section,
				locator: `paragraph ${paragraphIndex}`,
				text: chunk,
			});
		}
	}

	return spans;
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

	const sentences = splitSentences(paragraph);
	const chunks = [];
	let current = "";

	for (const sentence of sentences) {
		if (`${current} ${sentence}`.trim().length > MAX_PARAGRAPH_CHARS) {
			if (current) {
				chunks.push(current);
			}
			current = sentence;
		} else {
			current = `${current} ${sentence}`.trim();
		}
	}

	if (current) {
		chunks.push(current);
	}

	return chunks;
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

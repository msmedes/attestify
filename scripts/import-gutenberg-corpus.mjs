import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCES = [
	{
		gutenbergId: 1524,
		sourceId: "hamlet",
		title: "Hamlet",
		kind: "play",
	},
	{
		gutenbergId: 1533,
		sourceId: "macbeth",
		title: "Macbeth",
		kind: "play",
	},
	{
		gutenbergId: 2554,
		sourceId: "crime-and-punishment",
		title: "Crime and Punishment",
		kind: "novel",
	},
	{
		gutenbergId: 1342,
		sourceId: "pride-and-prejudice",
		title: "Pride and Prejudice",
		kind: "novel",
	},
	{
		gutenbergId: 1661,
		sourceId: "adventures-of-sherlock-holmes",
		title: "The Adventures of Sherlock Holmes",
		kind: "story-collection",
	},
	{
		gutenbergId: 11,
		sourceId: "alice-in-wonderland",
		title: "Alice's Adventures in Wonderland",
		kind: "novel",
	},
];

const GENERATED_PATH = path.join(
	process.cwd(),
	"src/features/attestations/generated/gutenberg-corpus.json",
);
const MANIFEST_PATH = path.join(
	process.cwd(),
	"src/features/attestations/generated/gutenberg-manifest.json",
);

const MAX_SPANS_PER_SOURCE = 700;
const MIN_PARAGRAPH_CHARS = 50;
const MAX_PARAGRAPH_CHARS = 1400;

const corpus = [];

for (const source of SOURCES) {
	const sourceUrl = `https://www.gutenberg.org/ebooks/${source.gutenbergId}.txt.utf-8`;
	const rawText = await fetchText(sourceUrl);
	const body = extractGutenbergBody(rawText);
	const spans = segmentText({
		sourceId: source.sourceId,
		title: source.title,
		text: body,
	}).slice(0, MAX_SPANS_PER_SOURCE);

	corpus.push({
		sourceId: source.sourceId,
		kind: source.kind,
		title: source.title,
		attribution: `Project Gutenberg eBook #${source.gutenbergId}`,
		updatedAt: new Date().toISOString().slice(0, 10),
		sourceUrl,
		spans,
	});
}

await mkdir(path.dirname(GENERATED_PATH), { recursive: true });
await writeFile(GENERATED_PATH, `${JSON.stringify(corpus, null, 2)}\n`);

const stats = corpus.reduce(
	(total, source) => ({
		documents: total.documents + 1,
		spans: total.spans + source.spans.length,
		attestations:
			total.attestations +
			source.spans.reduce(
				(count, span) => count + span.attestations.length,
				0,
			),
	}),
	{ documents: 0, spans: 0, attestations: 0 },
);

await writeFile(
	MANIFEST_PATH,
	`${JSON.stringify(
		{
			stats,
			sources: corpus.map((source) => ({
				sourceId: source.sourceId,
				kind: source.kind,
				title: source.title,
				attribution: source.attribution,
				updatedAt: source.updatedAt,
				sourceUrl: source.sourceUrl,
				spans: source.spans.length,
				attestations: source.spans.reduce(
					(count, span) => count + span.attestations.length,
					0,
				),
			})),
		},
		null,
		2,
	)}\n`,
);

console.log(
	`Imported ${stats.documents} documents, ${stats.spans} spans, ${stats.attestations} attestations.`,
);

async function fetchText(url) {
	const response = await fetch(url, {
		headers: {
			"user-agent": "attestify/0.1 (+https://www.gutenberg.org)",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status}`);
	}

	return response.text();
}

function extractGutenbergBody(text) {
	const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	const start = normalized.search(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK/i);
	const end = normalized.search(/\*\*\* END OF THE PROJECT GUTENBERG EBOOK/i);

	if (start < 0) {
		return normalized;
	}

	const firstLineAfterMarker = normalized.indexOf("\n", start);

	return trimToBodyStart(normalized.slice(
		firstLineAfterMarker >= 0 ? firstLineAfterMarker + 1 : start,
		end >= 0 ? end : undefined,
	));
}

function trimToBodyStart(body) {
	const headingPattern =
		/^(ACT\s+I\b\.?|CHAPTER\s+I\b|PART\s+I\b|BOOK\s+I\b|I\.\s+[A-Z])/gim;
	const matches = [...body.matchAll(headingPattern)];

	if (matches.length > 1 && typeof matches[1].index === "number") {
		return body.slice(matches[1].index);
	}

	if (matches.length === 1 && typeof matches[0].index === "number") {
		return body.slice(matches[0].index);
	}

	return body;
}

function segmentText({
	sourceId,
	text,
	title,
}) {
	const spans = [];
	let section = "Front matter";
	let paragraphIndex = 0;
	const paragraphs = text.split(/\n{2,}/);

	for (const rawParagraph of paragraphs) {
		const paragraph = normalizeParagraph(rawParagraph);

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
			const spanId = `${sourceId}-${String(paragraphIndex).padStart(5, "0")}`;

			spans.push({
				spanId,
				sourceId,
				section,
				locator: `paragraph ${paragraphIndex}`,
				text: chunk,
				attestations: buildAttestations({
					spanId,
					sourceId,
					sourceTitle: title,
					section,
					text: chunk,
				}),
			});
		}
	}

	return spans;
}

function parseHeading(paragraph) {
	const compact = paragraph.replace(/\s+/g, " ").trim();

	if (
		/^(ACT|SCENE|CHAPTER|PART|BOOK)\s+([IVXLC]+|\d+)/i.test(compact) ||
		/^[IVXLC]+\.\s+[A-Z]/.test(compact)
	) {
		return compact.slice(0, 120);
	}

	return null;
}

function splitLongParagraph(paragraph) {
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

function buildAttestations({ section, sourceTitle, spanId, text }) {
	const sentences = splitSentences(text)
		.filter((sentence) => sentence.length >= 30)
		.slice(0, 3);
	const attestations = sentences.map((sentence, index) => ({
		id: `att:${spanId}:sentence-${index + 1}`,
		type: "passage",
		subject: sourceTitle,
		predicate: "states",
		value: sentence,
		context: section,
		anchorText: sentence,
	}));

	if (attestations.length > 0) {
		return attestations;
	}

	return [
		{
			id: `att:${spanId}:passage`,
			type: "passage",
			subject: sourceTitle,
			predicate: "contains passage",
			value: text,
			context: section,
			anchorText: text,
		},
	];
}

function splitSentences(text) {
	return text
		.match(/[^.!?]+[.!?]+(?:["”’])?/g)
		?.map((sentence) => sentence.trim())
		.filter(Boolean) ?? [text.trim()];
}

function normalizeParagraph(paragraph) {
	return paragraph
		.replace(/\s+/g, " ")
		.replace(/\[_.*?_\]/g, "")
		.trim();
}

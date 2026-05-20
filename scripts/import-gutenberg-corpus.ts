import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildGutenbergSourceDocument } from "../src/features/attestations/gutenberg-adapter";
import type { SourceKind } from "../src/features/attestations/types";

const SOURCES: Array<{
	gutenbergId: number;
	sourceId: string;
	title: string;
	kind: SourceKind;
}> = [
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

const corpus = [];
const updatedAt = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Los_Angeles",
}).format(new Date());

for (const source of SOURCES) {
	const sourceUrl = `https://www.gutenberg.org/ebooks/${source.gutenbergId}.txt.utf-8`;
	const rawText = await fetchGutenbergText(source.gutenbergId, sourceUrl);
	const body = extractGutenbergBody(rawText);

	corpus.push(
		buildGutenbergSourceDocument({
			...source,
			body,
			maxSpans: MAX_SPANS_PER_SOURCE,
			sourceUrl,
			updatedAt,
		}),
	);
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
				ingestion: source.ingestion,
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

async function fetchGutenbergText(gutenbergId: number, primaryUrl: string) {
	const cacheUrl = `https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.txt`;
	const failures = [];

	for (const url of [primaryUrl, cacheUrl]) {
		const result = await fetchText(url);

		if (result.ok) {
			return result.text;
		}

		failures.push(`${url}: ${result.status}`);
	}

	throw new Error(`Failed to fetch Project Gutenberg text: ${failures.join("; ")}`);
}

async function fetchText(
	url: string,
): Promise<{ ok: true; text: string } | { ok: false; status: string }> {
	let lastStatus = "unknown";

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: {
					"user-agent": "attestify/0.1 (+https://www.gutenberg.org)",
				},
			});

			if (response.ok) {
				return { ok: true, text: await response.text() };
			}

			lastStatus = String(response.status);
		} catch (error) {
			lastStatus = error instanceof Error ? error.message : String(error);
		}

		await new Promise((resolve) => setTimeout(resolve, attempt * 500));
	}

	return { ok: false, status: lastStatus };
}

function extractGutenbergBody(text: string) {
	const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	const start = normalized.search(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK/i);
	const end = normalized.search(/\*\*\* END OF THE PROJECT GUTENBERG EBOOK/i);

	if (start < 0) {
		return normalized;
	}

	const firstLineAfterMarker = normalized.indexOf("\n", start);

	return trimToBodyStart(
		normalized.slice(
			firstLineAfterMarker >= 0 ? firstLineAfterMarker + 1 : start,
			end >= 0 ? end : undefined,
		),
	);
}

function trimToBodyStart(body: string) {
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

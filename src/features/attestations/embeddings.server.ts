import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { embedText as embedLocalText } from "./embed";
import { getOpenAiUnavailableReason, loadServerEnv } from "./env.server";

type EmbeddingProvider = "local-hash" | "openai";

export type EmbeddingConfig = {
	provider: EmbeddingProvider;
	model: string;
	dimensions: number;
};

const LOCAL_MODEL = "local-token-hash-v1";
const LOCAL_DIMENSIONS = 128;
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS = 1024;
const OPENAI_EMBEDDING_BATCH_SIZE = 128;

export function getEmbeddingConfig(): EmbeddingConfig {
	loadServerEnv();

	if (
		process.env.NODE_ENV === "test" ||
		getOpenAiUnavailableReason() ||
		process.env.OPENAI_EMBEDDINGS === "false"
	) {
		return {
			provider: "local-hash",
			model: LOCAL_MODEL,
			dimensions: LOCAL_DIMENSIONS,
		};
	}

	return {
		provider: "openai",
		model: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL,
		dimensions: parseEmbeddingDimensions(
			process.env.OPENAI_EMBEDDING_DIMENSIONS,
		),
	};
}

export function embeddingConfigKey(config: EmbeddingConfig): string {
	return `${config.provider}:${config.model}:${config.dimensions}`;
}

export async function embedQueryText({
	config,
	text,
}: {
	config: EmbeddingConfig;
	text: string;
}): Promise<number[]> {
	if (config.provider === "local-hash") {
		return embedLocalText(text);
	}

	return (await embedOpenAiTexts({ config, texts: [text] }))[0] ?? [];
}

export async function embedCorpusTexts({
	cachePath,
	config,
	items,
}: {
	cachePath: string;
	config: EmbeddingConfig;
	items: Array<{
		id: string;
		text: string;
	}>;
}): Promise<Map<string, number[]>> {
	if (config.provider === "local-hash") {
		return new Map(items.map((item) => [item.id, embedLocalText(item.text)]));
	}

	const cached = readEmbeddingCache(cachePath, config);
	const embeddings = new Map(cached.embeddings);
	const missingItems = items.filter((item) => !embeddings.has(item.id));

	for (
		let index = 0;
		index < missingItems.length;
		index += OPENAI_EMBEDDING_BATCH_SIZE
	) {
		const batch = missingItems.slice(
			index,
			index + OPENAI_EMBEDDING_BATCH_SIZE,
		);
		const vectors = await embedOpenAiTexts({
			config,
			texts: batch.map((item) => item.text),
		});

		for (const [batchIndex, item] of batch.entries()) {
			const vector = vectors[batchIndex];

			if (!vector) {
				throw new Error(`OpenAI did not return an embedding for ${item.id}.`);
			}

			embeddings.set(item.id, vector);
		}

		await writeEmbeddingCache(cachePath, config, embeddings);
	}

	return embeddings;
}

function parseEmbeddingDimensions(value: string | undefined): number {
	if (!value) {
		return DEFAULT_OPENAI_EMBEDDING_DIMENSIONS;
	}

	const dimensions = Number.parseInt(value, 10);

	if (!Number.isFinite(dimensions) || dimensions < 1) {
		return DEFAULT_OPENAI_EMBEDDING_DIMENSIONS;
	}

	return dimensions;
}

async function embedOpenAiTexts({
	config,
	texts,
}: {
	config: EmbeddingConfig;
	texts: string[];
}): Promise<number[][]> {
	const response = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: {
			authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: config.model,
			input: texts,
			dimensions: config.dimensions,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`OpenAI embeddings failed: ${response.status} ${body}`);
	}

	const payload = (await response.json()) as {
		data?: Array<{
			index: number;
			embedding: number[];
		}>;
	};

	return (payload.data ?? [])
		.sort((left, right) => left.index - right.index)
		.map((item) => item.embedding);
}

function readEmbeddingCache(
	cachePath: string,
	config: EmbeddingConfig,
): {
	embeddings: Array<[string, number[]]>;
} {
	if (!existsSync(cachePath)) {
		return { embeddings: [] };
	}

	const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
		config?: EmbeddingConfig;
		embeddings?: Array<[string, number[]]>;
	};

	if (
		!parsed.config ||
		embeddingConfigKey(parsed.config) !== embeddingConfigKey(config)
	) {
		return { embeddings: [] };
	}

	return {
		embeddings: parsed.embeddings ?? [],
	};
}

async function writeEmbeddingCache(
	cachePath: string,
	config: EmbeddingConfig,
	embeddings: Map<string, number[]>,
) {
	await mkdir(path.dirname(cachePath), { recursive: true });
	await writeFile(
		cachePath,
		`${JSON.stringify(
			{
				config,
				embeddings: [...embeddings],
			},
			null,
			2,
		)}\n`,
	);
}

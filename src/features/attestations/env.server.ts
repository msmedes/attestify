import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { OPENAI_CHAT_MODELS, type OpenAIChatModel } from "@tanstack/ai-openai";
import { z } from "zod";

const ENV_FILES = [".env.local", ".env"];
const DEFAULT_OPENAI_MODEL = "gpt-5.4-nano";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS = 1024;

const serverEnvSchema = z.object({
	nodeEnv: z.string().default("development"),
	openAi: z.object({
		disabled: z.boolean(),
		apiKey: z.string().optional(),
		model: z.preprocess(
			(value) =>
				value === undefined || value === "" ? DEFAULT_OPENAI_MODEL : value,
			z.enum(OPENAI_CHAT_MODELS),
		),
		embeddingsEnabled: z.boolean(),
		embeddingModel: z
			.string()
			.trim()
			.min(1)
			.catch(DEFAULT_OPENAI_EMBEDDING_MODEL),
		embeddingDimensions: z.coerce
			.number()
			.int()
			.positive()
			.catch(DEFAULT_OPENAI_EMBEDDING_DIMENSIONS),
	}),
});

export type ServerEnv = z.infer<typeof serverEnvSchema> & {
	openAi: z.infer<typeof serverEnvSchema>["openAi"] & {
		model: OpenAIChatModel;
	};
};

function loadServerEnv() {
	for (const fileName of ENV_FILES) {
		const filePath = path.join(process.cwd(), fileName);

		if (!existsSync(filePath)) {
			continue;
		}

		for (const [key, value] of parseEnvFile(readFileSync(filePath, "utf8"))) {
			if (process.env[key] === undefined) {
				process.env[key] = value;
			}
		}
	}
}

export const serverEnv: ServerEnv = (() => {
	loadServerEnv();

	return serverEnvSchema.parse({
		nodeEnv: process.env.NODE_ENV,
		openAi: {
			disabled: process.env.ATTESTIFY_OPENAI_DISABLED === "true",
			apiKey: process.env.OPENAI_API_KEY || undefined,
			model: process.env.OPENAI_MODEL,
			embeddingsEnabled: process.env.OPENAI_EMBEDDINGS !== "false",
			embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
			embeddingDimensions: process.env.OPENAI_EMBEDDING_DIMENSIONS,
		},
	});
})();

export function getOpenAiUnavailableReason(): string | null {
	if (serverEnv.openAi.disabled) {
		return "OpenAI is disabled by ATTESTIFY_OPENAI_DISABLED.";
	}

	if (!serverEnv.openAi.apiKey) {
		return "OPENAI_API_KEY is not configured.";
	}

	return null;
}

function parseEnvFile(contents: string): Array<[string, string]> {
	return contents.split(/\r?\n/).flatMap((line): Array<[string, string]> => {
		const trimmed = line.trim();

		if (!trimmed || trimmed.startsWith("#")) {
			return [];
		}

		const separatorIndex = trimmed.indexOf("=");

		if (separatorIndex < 1) {
			return [];
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		const rawValue = trimmed.slice(separatorIndex + 1).trim();

		if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
			return [];
		}

		return [[key, unquote(rawValue)]];
	});
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}

	return value;
}

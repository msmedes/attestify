import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ENV_FILES = [".env.local", ".env"];

export function loadServerEnv() {
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

export function getOpenAiUnavailableReason(): string | null {
	loadServerEnv();

	if (process.env.ATTESTIFY_OPENAI_DISABLED === "true") {
		return "OpenAI is disabled by ATTESTIFY_OPENAI_DISABLED.";
	}

	if (!process.env.OPENAI_API_KEY) {
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

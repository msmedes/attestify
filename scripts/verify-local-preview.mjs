import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.PORT ?? 3010);
const origin = `http://localhost:${port}`;

await assertPortAvailable(origin);

const server = spawn(process.execPath, [".output/server/index.mjs"], {
	env: {
		...process.env,
		ATTESTIFY_OPENAI_DISABLED: "true",
		OPENAI_API_KEY: "",
		OPENAI_EMBEDDINGS: "false",
		PORT: String(port),
	},
	stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";

server.stdout.on("data", (chunk) => {
	serverOutput += chunk.toString();
});

server.stderr.on("data", (chunk) => {
	serverOutput += chunk.toString();
});

try {
	await waitForServer(origin);
	await verifyAppShell(origin);
	await verifyNoKeyAnswerFallback(origin);
	await verifyCorpusBrowser(origin);
	await verifyHistory(origin);
	console.log(`Verified built preview at ${origin}`);
} finally {
	server.kill("SIGTERM");
}

async function waitForServer(baseUrl) {
	const deadline = Date.now() + 15_000;
	let lastError;

	while (Date.now() < deadline) {
		if (server.exitCode !== null) {
			throw new Error(
				`Preview server exited early with code ${server.exitCode}.\n${serverOutput}`,
			);
		}

		try {
			const response = await fetch(baseUrl);

			if (response.ok) {
				await delay(100);

				if (server.exitCode !== null) {
					throw new Error(
						`Preview server exited early with code ${server.exitCode}.\n${serverOutput}`,
					);
				}

				return;
			}

			lastError = new Error(`Server returned ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await delay(250);
	}

	throw new Error(
		`Preview server did not become ready at ${baseUrl}: ${formatError(
			lastError,
		)}\n${serverOutput}`,
	);
}

async function assertPortAvailable(baseUrl) {
	try {
		const response = await fetch(baseUrl);
		await response.body?.cancel();

		throw new Error(
			`Port ${port} is already serving HTTP ${response.status}. Stop the existing preview server before running verify:preview.`,
		);
	} catch (error) {
		if (error instanceof Error && error.message.includes("already serving")) {
			throw error;
		}
	}
}

async function verifyAppShell(baseUrl) {
	const response = await fetch(baseUrl);
	assertOk(response, "App shell");
	const html = await response.text();

	assert(
		html.includes("Source-faithful retrieval lab"),
		"App shell did not include the Attestify heading.",
	);
}

async function verifyNoKeyAnswerFallback(baseUrl) {
	const response = await fetch(`${baseUrl}/api/answer`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ query: "What is the mousetrap in Hamlet?" }),
	});
	assertOk(response, "No-key answer route");
	const payload = await response.json();

	assert(
		payload.aiAnswer?.status === "unavailable",
		"No-key answer route did not report unavailable answer synthesis.",
	);
	assert(
		payload.aiTrace?.steps?.some(
			(step) =>
				step.stage === "config" &&
				step.status === "skipped" &&
				(String(step.error).includes("OPENAI_API_KEY") ||
					String(step.error).includes("ATTESTIFY_OPENAI_DISABLED")),
		),
		"No-key answer route did not include the unavailable-OpenAI trace step.",
	);
	assert(
		Array.isArray(payload.citations) && payload.citations.length > 0,
		"No-key answer route did not return citation cards.",
	);
	assert(
		Array.isArray(payload.retrievalChunks) && payload.retrievalChunks.length > 0,
		"No-key answer route did not return raw retrieval chunks.",
	);
}

async function verifyCorpusBrowser(baseUrl) {
	const response = await fetch(`${baseUrl}/api/corpus?view=docs`);
	assertOk(response, "Corpus browser");
	const payload = await response.json();

	assert(payload.type === "docs", "Corpus browser did not return docs view.");
	assert(
		payload.manifest?.stats?.documents > 0,
		"Corpus browser manifest did not include documents.",
	);
}

async function verifyHistory(baseUrl) {
	const response = await fetch(`${baseUrl}/api/history`);
	assertOk(response, "Query history");
	const payload = await response.json();

	assert(Array.isArray(payload.runs), "Query history did not return runs.");
	assert(
		payload.runs.some((run) => run.query === "What is the mousetrap in Hamlet?"),
		"Query history did not include the smoke-test answer run.",
	);
}

function assertOk(response, label) {
	assert(response.ok, `${label} returned HTTP ${response.status}.`);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function formatError(error) {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

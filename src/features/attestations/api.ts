import type {
	QueryRunDetail,
	QueryRunSummary,
	SearchRequest,
	SearchResponse,
} from "./types";

export async function answerWithAttestations(
	request: SearchRequest,
): Promise<SearchResponse> {
	return postSearchRequest("/api/answer", request);
}

export async function searchAttestations(
	request: SearchRequest,
): Promise<SearchResponse> {
	return postSearchRequest("/api/search", request);
}

export async function listQueryHistory(): Promise<QueryRunSummary[]> {
	const response = await fetch("/api/history");

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `History failed with ${response.status}`);
	}

	const body = (await response.json()) as { runs: QueryRunSummary[] };

	return body.runs;
}

export async function getQueryHistoryRun(id: string): Promise<QueryRunDetail> {
	const response = await fetch(`/api/history/${encodeURIComponent(id)}`);

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `History run failed with ${response.status}`);
	}

	const body = (await response.json()) as { run: QueryRunDetail };

	return body.run;
}

async function postSearchRequest(
	url: string,
	request: SearchRequest,
): Promise<SearchResponse> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `Search failed with ${response.status}`);
	}

	return response.json() as Promise<SearchResponse>;
}

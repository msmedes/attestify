import type { SearchRequest, SearchResponse } from "./types";

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

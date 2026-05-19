import { describe, expect, it } from "vitest";
import {
	BadSearchRequestError,
	MAX_QUERY_LENGTH,
	parseSearchRequest,
} from "./request";

function jsonRequest(body: unknown): Request {
	return new Request("http://attestify.test/api/search", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

describe("parseSearchRequest", () => {
	it("normalizes valid search queries", async () => {
		await expect(
			parseSearchRequest(jsonRequest({ query: "  Hamlet\n mousetrap  " })),
		).resolves.toEqual({ query: "Hamlet mousetrap" });
	});

	it("rejects malformed JSON as a bad request", async () => {
		const request = new Request("http://attestify.test/api/search", {
			method: "POST",
			body: "{",
		});

		await expect(parseSearchRequest(request)).rejects.toBeInstanceOf(
			BadSearchRequestError,
		);
	});

	it("rejects short and oversized queries", async () => {
		await expect(
			parseSearchRequest(jsonRequest({ query: "x" })),
		).rejects.toThrow("at least 2 characters");
		await expect(
			parseSearchRequest(
				jsonRequest({ query: "x".repeat(MAX_QUERY_LENGTH + 1) }),
			),
		).rejects.toThrow(`${MAX_QUERY_LENGTH} characters or fewer`);
	});
});

import { z } from "zod";
import type { SearchRequest } from "./types";

export const MAX_QUERY_LENGTH = 500;

const searchRequestSchema = z.object({
	query: z
		.string()
		.transform((query) => query.replace(/\s+/g, " ").trim())
		.pipe(
			z
				.string()
				.min(2, "Query must be at least 2 characters.")
				.max(
					MAX_QUERY_LENGTH,
					`Query must be ${MAX_QUERY_LENGTH} characters or fewer.`,
				),
		),
});

export class BadSearchRequestError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "BadSearchRequestError";
	}
}

export async function parseSearchRequest(
	request: Request,
): Promise<SearchRequest> {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		throw new BadSearchRequestError("Request body must be valid JSON.");
	}

	const parsed = searchRequestSchema.safeParse(body);

	if (!parsed.success) {
		throw new BadSearchRequestError(
			parsed.error.issues.at(0)?.message ?? "Invalid search request.",
		);
	}

	return parsed.data;
}

export function searchRequestErrorResponse(error: unknown): Response | null {
	if (!(error instanceof BadSearchRequestError)) {
		return null;
	}

	return Response.json(
		{
			error: error.message,
		},
		{
			status: error.status,
		},
	);
}

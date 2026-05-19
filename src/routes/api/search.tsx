import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import type { SearchRequest } from "#/features/attestations/types";

export const Route = createFileRoute("/api/search")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const body = (await request.json()) as Partial<SearchRequest>;
				const query = typeof body.query === "string" ? body.query.trim() : "";

				if (query.length < 2) {
					return new Response("Query must be at least 2 characters.", {
						status: 400,
					});
				}

				const { searchCorpus } = await import(
					"#/features/attestations/search.server"
				);

				return json(await searchCorpus(query));
			},
		},
	},
});

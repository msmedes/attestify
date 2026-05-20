import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
	BadSearchRequestError,
	parseSearchRequest,
} from "#/features/attestations/request";

export const Route = createFileRoute("/api/answer")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				let searchRequest: Awaited<ReturnType<typeof parseSearchRequest>>;

				try {
					searchRequest = await parseSearchRequest(request);
				} catch (error) {
					if (error instanceof BadSearchRequestError) {
						return Response.json(
							{ error: error.message },
							{ status: error.status },
						);
					}

					throw error;
				}

				const { answerCorpus } = await import(
					"#/features/attestations/answer.server"
				);

				return json(
					await answerCorpus(searchRequest.query, searchRequest.queryMode),
				);
			},
		},
	},
});

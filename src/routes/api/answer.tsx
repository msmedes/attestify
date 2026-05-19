import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
	parseSearchRequest,
	searchRequestErrorResponse,
} from "#/features/attestations/request";

export const Route = createFileRoute("/api/answer")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				let query: string;

				try {
					query = (await parseSearchRequest(request)).query;
				} catch (error) {
					const response = searchRequestErrorResponse(error);

					if (response) {
						return response;
					}

					throw error;
				}

				const { answerCorpus } = await import(
					"#/features/attestations/answer.server"
				);

				return json(await answerCorpus(query));
			},
		},
	},
});

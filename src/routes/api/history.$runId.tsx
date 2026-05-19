import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/history/$runId")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const { getQueryRunDetail } = await import(
					"#/features/attestations/history.server"
				);
				const run = getQueryRunDetail(params.runId);

				if (!run) {
					return new Response("History run not found.", {
						status: 404,
					});
				}

				return json({ run });
			},
		},
	},
});

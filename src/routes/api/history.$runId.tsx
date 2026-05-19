import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/history/$runId")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const { CorruptHistoryRunError, getQueryRunDetail } = await import(
					"#/features/attestations/history.server"
				);
				let run: ReturnType<typeof getQueryRunDetail>;

				try {
					run = getQueryRunDetail(params.runId);
				} catch (error) {
					if (error instanceof CorruptHistoryRunError) {
						return Response.json(
							{ error: "History run is corrupt and cannot be loaded." },
							{ status: 500 },
						);
					}

					throw error;
				}

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

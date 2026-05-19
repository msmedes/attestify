import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/history")({
	server: {
		handlers: {
			GET: async () => {
				const { listQueryRunSummaries } = await import(
					"#/features/attestations/history.server"
				);

				return json({ runs: listQueryRunSummaries() });
			},
		},
	},
});

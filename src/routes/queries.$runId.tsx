import { createFileRoute } from "@tanstack/react-router";
import { QueryRunPage } from "#/features/attestations/components/QueryRunPage";

export const Route = createFileRoute("/queries/$runId")({
	component: QueryRoute,
});

function QueryRoute() {
	const { runId } = Route.useParams();

	return <QueryRunPage runId={runId} />;
}

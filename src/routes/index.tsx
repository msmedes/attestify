import { createFileRoute } from "@tanstack/react-router";
import { AttestationLab } from "#/features/attestations/components/AttestationLab";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return <AttestationLab />;
}

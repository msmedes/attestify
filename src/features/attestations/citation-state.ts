import type { CitationUnit } from "./types";

export type CitationDiagnosticState =
	| {
			status: "resolved";
			label: "Resolved";
			description: string;
	  }
	| {
			status: "stale";
			label: "Older snapshot";
			description: string;
	  }
	| {
			status: "unresolved";
			label: "Unresolved";
			description: string;
	  };

export function citationDiagnosticState(
	citation: CitationUnit,
): CitationDiagnosticState {
	if (citation.historyEvidence?.status === "unresolved") {
		return {
			status: "unresolved",
			label: "Unresolved",
			description: citation.historyEvidence.reason,
		};
	}

	if (citation.citationIdentity.status === "legacy") {
		return {
			status: "stale",
			label: "Older snapshot",
			description:
				"Saved citation uses persisted evidence without current structured snapshot resolution.",
		};
	}

	if (citation.historyEvidence?.status === "persisted") {
		if (citation.historyEvidence.context === "saved-history") {
			return {
				status: "stale",
				label: "Older snapshot",
				description:
					"Saved citation renders persisted evidence from the recorded answer run.",
			};
		}

		return {
			status: "resolved",
			label: "Resolved",
			description:
				"Citation identity resolves to source-backed evidence for this response.",
		};
	}

	return {
		status: "resolved",
		label: "Resolved",
		description:
			"Citation identity resolves to source-backed evidence for this response.",
	};
}

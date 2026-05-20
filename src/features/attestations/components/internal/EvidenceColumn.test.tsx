/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CitationUnit } from "../../types";
import { EvidenceColumn } from "./EvidenceColumn";

describe("EvidenceColumn citation diagnostics", () => {
	it("renders resolved, stale, and unresolved citation states distinctly", () => {
		render(
			<EvidenceColumn
				citations={[
					citation({
						label: "[1]",
						subject: "Resolved source",
						historyEvidence: persistedEvidence("current-response"),
					}),
					citation({
						label: "[2]",
						subject: "Saved source",
						historyEvidence: persistedEvidence("saved-history"),
					}),
					citation({
						label: "[3]",
						subject: "Missing source",
						historyEvidence: {
							status: "unresolved",
							reason:
								"Persisted history citation is missing source text or quote evidence.",
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText(/^Resolved:/).textContent).toBe("Resolved: 1");
		expect(screen.getByText(/^Older snapshot:/).textContent).toBe(
			"Older snapshot: 1",
		);
		expect(screen.getByText(/^Unresolved:/).textContent).toBe("Unresolved: 1");
		expect(screen.getAllByText("Resolved")).toHaveLength(1);
		expect(screen.getAllByText("Older snapshot")).toHaveLength(1);
		expect(screen.getAllByText("Unresolved")).toHaveLength(1);
		expect(
			screen.getByText(
				"Saved citation renders persisted evidence from the recorded answer run.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Persisted history citation is missing source text or quote evidence.",
			),
		).toBeTruthy();
		expect(
			screen.queryAllByText(/anchor substring check over source span/),
		).toHaveLength(1);
	});
});

function citation({
	label,
	subject,
	historyEvidence,
}: {
	label: string;
	subject: string;
	historyEvidence: CitationUnit["historyEvidence"];
}): CitationUnit {
	const spanId = label.replace(/\D/g, "") || "1";

	return {
		attestation: {
			id: `att:hamlet-${spanId}:passage`,
			type: "passage",
			subject,
			predicate: "contains passage",
			value: "The Mousetrap",
			context: "Act 3",
			anchorText: "The Mousetrap",
		},
		source: {
			sourceId: "hamlet",
			title: "Hamlet",
			kind: "play",
			attribution: "Fixture",
			updatedAt: "2026-05-19",
		},
		span: {
			spanId: `hamlet-${spanId}`,
			section: "Act 3",
			locator: `paragraph ${spanId}`,
			text: "The Mousetrap appears in persisted evidence.",
		},
		citationHandle: `att:hamlet-${spanId}:passage#hamlet-${spanId}`,
		citationLabel: label,
		citationIdentity: {
			status: "resolvable",
			legacyHandle: `att:hamlet-${spanId}:passage#hamlet-${spanId}`,
			connectorId: "project-gutenberg",
			externalSourceId: "1524",
			sourceSnapshot: {
				snapshotId: "snapshot-1",
				version: "gutenberg-1524-utf8",
			},
			span: {
				spanId: `span-${spanId}`,
				legacySpanId: `hamlet-${spanId}`,
				locator: `paragraph ${spanId}`,
			},
			attestation: {
				attestationId: `attestation-${spanId}`,
				legacyAttestationId: `att:hamlet-${spanId}:passage`,
			},
		},
		historyEvidence,
		support: {
			verifiedAgainstSource: true,
			method: "anchor substring check over source span",
		},
		score: 1,
	};
}

function persistedEvidence(
	context: "current-response" | "saved-history",
): NonNullable<CitationUnit["historyEvidence"]> {
	return {
		status: "persisted",
		context,
		sourceTitle: "Hamlet",
		section: "Act 3",
		locator: "paragraph 1",
		quote: "The Mousetrap",
		sourceText: "The Mousetrap appears in persisted evidence.",
	};
}

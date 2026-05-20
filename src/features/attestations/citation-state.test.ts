import { describe, expect, it } from "vitest";
import { citationDiagnosticState } from "./citation-state";
import type { CitationUnit } from "./types";

describe("citation diagnostic state", () => {
	it("marks current structured citations as resolved", () => {
		expect(
			citationDiagnosticState({
				...baseCitation(),
				historyEvidence: persistedEvidence("current-response"),
			}).status,
		).toBe("resolved");
	});

	it("marks persisted history evidence as older snapshot", () => {
		expect(
			citationDiagnosticState({
				...baseCitation(),
				historyEvidence: persistedEvidence("saved-history"),
			}).status,
		).toBe("stale");
	});

	it("marks missing saved evidence as unresolved", () => {
		expect(
			citationDiagnosticState({
				...baseCitation(),
				historyEvidence: {
					status: "unresolved",
					reason: "Missing persisted evidence.",
				},
			}),
		).toMatchObject({
			status: "unresolved",
			description: "Missing persisted evidence.",
		});
	});
});

function baseCitation(): CitationUnit {
	return {
		attestation: {
			id: "att:hamlet-00001:passage",
			type: "passage",
			subject: "Hamlet",
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
			spanId: "hamlet-00001",
			section: "Act 3",
			locator: "paragraph 1",
			text: "The Mousetrap",
		},
		citationHandle: "att:hamlet-00001:passage#hamlet-00001",
		citationLabel: "[1]",
		citationIdentity: {
			status: "resolvable",
			legacyHandle: "att:hamlet-00001:passage#hamlet-00001",
			connectorId: "project-gutenberg",
			externalSourceId: "1524",
			sourceSnapshot: {
				snapshotId: "snapshot-1",
				version: "gutenberg-1524-utf8",
			},
			span: {
				spanId: "span-1",
				legacySpanId: "hamlet-00001",
				locator: "paragraph 1",
			},
			attestation: {
				attestationId: "attestation-1",
				legacyAttestationId: "att:hamlet-00001:passage",
			},
		},
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

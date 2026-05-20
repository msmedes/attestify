import { describe, expect, it } from "vitest";
import {
	type ClaimVerifier,
	claimsSafeForAnswerSegments,
	verifyAnswerClaims,
} from "./claim-verification";
import type { CitationUnit } from "./types";

describe("claim verification", () => {
	it("verifies generated claims against hydrated citation evidence", async () => {
		const claims = await verifyAnswerClaims({
			claims: [
				{
					text: "Hamlet uses the Mousetrap to catch the conscience of the king.",
					citationHandles: ["att:1#span:1"],
				},
			],
			citations: [citationUnit()],
			verifier: fakeVerifier("supported"),
		});

		expect(claims[0]).toMatchObject({
			text: "Hamlet uses the Mousetrap to catch the conscience of the king.",
			citationHandles: ["att:1#span:1"],
			verification: {
				status: "supported",
				evidence: [
					expect.objectContaining({
						citationHandle: "att:1#span:1",
						anchorQuote:
							"The play's the thing wherein I'll catch the conscience of the King.",
						sourceTitle: "Hamlet",
						locator: "Act 2, paragraph 1",
						sourceSnapshotId: "snapshot:hamlet",
					}),
				],
			},
		});
	});

	it("marks unknown citation handles as missing before verifier execution", async () => {
		let verifierCalls = 0;
		const claims = await verifyAnswerClaims({
			claims: [
				{
					text: "Hamlet says something unsupported.",
					citationHandles: ["missing#handle"],
				},
			],
			citations: [citationUnit()],
			verifier: {
				verify() {
					verifierCalls += 1;
					return {
						status: "supported",
						method: "fake",
						rationale: "should not run",
						evidence: [],
					};
				},
			},
		});

		expect(verifierCalls).toBe(0);
		expect(claims[0]?.verification).toMatchObject({
			status: "missing",
			method: "citation-handle-resolution",
		});
	});

	it.each([
		"supported",
		"weak",
		"contradicted",
		"missing",
	] as const)("carries %s status through verification records", async (status) => {
		const claims = await verifyAnswerClaims({
			claims: [
				{
					text: `Claim with ${status} source support.`,
					citationHandles: ["att:1#span:1"],
				},
			],
			citations: [citationUnit()],
			verifier: fakeVerifier(status),
		});

		expect(claims[0]?.verification.status).toBe(status);
	});

	it("does not render contradicted or missing claims as normal supported answer claims", () => {
		const safeClaims = claimsSafeForAnswerSegments([
			verifiedClaim("Supported claim.", "supported"),
			verifiedClaim("Weak claim.", "weak"),
			verifiedClaim("Contradicted claim.", "contradicted"),
			verifiedClaim("Missing claim.", "missing"),
		]);

		expect(safeClaims).toEqual([
			{
				text: "Supported claim.",
				citationHandles: ["att:1#span:1"],
			},
			{
				text: "Weak claim. (The cited evidence only weakly supports this claim.)",
				citationHandles: ["att:1#span:1"],
			},
		]);
	});
});

function fakeVerifier(
	status: "supported" | "weak" | "contradicted" | "missing",
): ClaimVerifier {
	return {
		verify({ evidence }) {
			return {
				status,
				method: "fake-verifier",
				rationale: `Fake ${status} result.`,
				evidence,
			};
		},
	};
}

function verifiedClaim(
	text: string,
	status: "supported" | "weak" | "contradicted" | "missing",
) {
	return {
		text,
		citationHandles: ["att:1#span:1"],
		verification: {
			status,
			method: "fake-verifier",
			rationale: `Fake ${status} result.`,
			evidence: [],
		},
	};
}

function citationUnit(): CitationUnit {
	return {
		attestation: {
			id: "att:1",
			type: "passage",
			subject: "Hamlet",
			predicate: "says",
			value: "The play's the thing.",
			context: "testing Claudius",
			anchorText:
				"The play's the thing wherein I'll catch the conscience of the King.",
		},
		source: {
			sourceId: "hamlet",
			title: "Hamlet",
			kind: "play",
			attribution: "Fixture",
			updatedAt: "2026-05-19",
		},
		span: {
			spanId: "span:1",
			section: "Act 2",
			locator: "paragraph 1",
			text: "The play's the thing wherein I'll catch the conscience of the King.",
		},
		citationHandle: "att:1#span:1",
		citationIdentity: {
			status: "resolvable",
			legacyHandle: "att:1#span:1",
			connectorId: "fixture",
			externalSourceId: "hamlet",
			sourceSnapshot: {
				snapshotId: "snapshot:hamlet",
				version: "fixture",
			},
			span: {
				spanId: "span:structured",
				legacySpanId: "span:1",
				locator: "paragraph 1",
			},
			attestation: {
				attestationId: "att:structured",
				legacyAttestationId: "att:1",
			},
		},
		citationLabel: "[1]",
		support: {
			verifiedAgainstSource: true,
			method: "fixture",
		},
		score: 1,
	};
}

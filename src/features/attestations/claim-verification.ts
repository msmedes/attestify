import { tokenize } from "./embed";
import type { CitationUnit } from "./types";

export type ClaimVerificationStatus =
	| "supported"
	| "contradicted"
	| "weak"
	| "missing";

export type AnswerClaimInput = {
	text: string;
	citationHandles: string[];
};

export type ClaimEvidence = {
	citationHandle: string;
	attestationText: string;
	anchorQuote: string;
	sourceSpanText: string;
	sourceTitle: string;
	locator: string;
	sourceSnapshotId?: string;
	citationIdentityStatus: CitationUnit["citationIdentity"]["status"];
};

export type ClaimVerification = {
	status: ClaimVerificationStatus;
	method: string;
	rationale: string;
	evidence: ClaimEvidence[];
};

export type VerifiedAnswerClaim = AnswerClaimInput & {
	verification: ClaimVerification;
};

export type ClaimVerifier = {
	verify(input: {
		claim: AnswerClaimInput;
		evidence: ClaimEvidence[];
	}): ClaimVerification | Promise<ClaimVerification>;
};

export const lexicalClaimVerifier: ClaimVerifier = {
	verify({ claim, evidence }) {
		if (evidence.length === 0) {
			return {
				status: "missing",
				method: "lexical-overlap",
				rationale: "No cited evidence was available for this claim.",
				evidence,
			};
		}

		const evidenceText = evidence
			.flatMap((item) => [
				item.attestationText,
				item.anchorQuote,
				item.sourceSpanText,
				item.sourceTitle,
				item.locator,
			])
			.join(" ");
		const overlap = tokenOverlap(claim.text, evidenceText);

		return {
			status: overlap >= 0.45 ? "supported" : "weak",
			method: "lexical-overlap",
			rationale:
				overlap >= 0.45
					? "Claim terms overlap cited source evidence."
					: "Claim has only weak lexical support from cited source evidence.",
			evidence,
		};
	},
};

export async function verifyAnswerClaims({
	claims,
	citations,
	verifier = lexicalClaimVerifier,
}: {
	claims: AnswerClaimInput[];
	citations: CitationUnit[];
	verifier?: ClaimVerifier;
}): Promise<VerifiedAnswerClaim[]> {
	const citationsByHandle = new Map(
		citations.map((citation) => [citation.citationHandle, citation]),
	);

	const verifiedClaims = [];

	for (const claim of claims) {
		const evidence = claim.citationHandles.flatMap((citationHandle) => {
			const citation = citationsByHandle.get(citationHandle);

			return citation ? [toClaimEvidence(citation)] : [];
		});
		const verification =
			evidence.length === claim.citationHandles.length
				? await verifier.verify({ claim, evidence })
				: {
						status: "missing" as const,
						method: "citation-handle-resolution",
						rationale:
							"One or more cited handles were missing from hydrated answer evidence.",
						evidence,
					};

		verifiedClaims.push({
			text: claim.text,
			citationHandles: claim.citationHandles,
			verification,
		});
	}

	return verifiedClaims;
}

export function claimsSafeForAnswerSegments(
	claims: VerifiedAnswerClaim[],
): AnswerClaimInput[] {
	return claims
		.filter(
			(claim) =>
				claim.verification.status === "supported" ||
				claim.verification.status === "weak",
		)
		.map((claim) => ({
			text:
				claim.verification.status === "weak"
					? `${claim.text} (The cited evidence only weakly supports this claim.)`
					: claim.text,
			citationHandles: claim.citationHandles,
		}));
}

function toClaimEvidence(citation: CitationUnit): ClaimEvidence {
	return {
		citationHandle: citation.citationHandle,
		attestationText: [
			citation.attestation.subject,
			citation.attestation.predicate,
			citation.attestation.value,
			citation.attestation.context,
		].join(" "),
		anchorQuote: citation.attestation.anchorText,
		sourceSpanText: citation.span.text,
		sourceTitle: citation.source.title,
		locator: `${citation.span.section}, ${citation.span.locator}`,
		sourceSnapshotId:
			citation.citationIdentity.status === "resolvable"
				? citation.citationIdentity.sourceSnapshot.snapshotId
				: undefined,
		citationIdentityStatus: citation.citationIdentity.status,
	};
}

function tokenOverlap(query: string, target: string): number {
	const queryTokens = new Set(tokenize(query));
	const targetTokens = new Set(tokenize(target));

	if (queryTokens.size === 0 || targetTokens.size === 0) {
		return 0;
	}

	let overlap = 0;

	for (const token of queryTokens) {
		if (targetTokens.has(token)) {
			overlap += 1;
		}
	}

	return overlap / queryTokens.size;
}

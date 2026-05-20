/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerPanel } from "./AnswerPanel";

describe("AnswerPanel claim verification diagnostics", () => {
	it("renders claim support statuses and evidence handles distinctly", () => {
		render(
			<AnswerPanel
				aiAnswer={{
					status: "ready",
					segments: [{ type: "text", text: "Verified answer." }],
					claims: [
						claim("Supported claim.", "supported", ["att:1#span:1"]),
						claim("Weak claim.", "weak", ["att:2#span:2"]),
						claim("Contradicted claim.", "contradicted", ["att:3#span:3"]),
						claim("Missing claim.", "missing", []),
					],
				}}
				lines={[]}
				query="What happened?"
				retrievalQueries={["What happened?"]}
			/>,
		);

		expect(screen.getByText("Claim evidence support")).toBeTruthy();
		expect(screen.getByText("supported")).toBeTruthy();
		expect(screen.getByText("weak support")).toBeTruthy();
		expect(screen.getByText("contradicted")).toBeTruthy();
		expect(screen.getByText("missing support")).toBeTruthy();
		expect(
			screen.getAllByText(
				"source evidence support, not world-truth verification",
			),
		).toHaveLength(4);
		expect(screen.getByText("att:1#span:1")).toBeTruthy();
		expect(screen.getByText("att:3#span:3")).toBeTruthy();
	});
});

function claim(
	text: string,
	status: "supported" | "weak" | "contradicted" | "missing",
	citationHandles: string[],
) {
	return {
		text,
		citationHandles,
		verification: {
			status,
			method: "fake",
			rationale: `${status} rationale`,
			evidence: citationHandles.map((citationHandle) => ({
				citationHandle,
				attestationText: "attestation",
				anchorQuote: "quote",
				sourceSpanText: "source text",
				sourceTitle: "Source",
				locator: "Section, paragraph 1",
				citationIdentityStatus: "legacy" as const,
			})),
		},
	};
}

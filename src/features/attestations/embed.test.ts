import { describe, expect, it } from "vitest";
import { embedText, tokenize } from "./embed";

describe("embedding helpers", () => {
	it("normalizes apostrophes into searchable Shakespeare tokens", () => {
		expect(tokenize("Whether 'tis nobler")).toContain("'tis");
	});

	it("creates fixed-size vectors", () => {
		expect(embedText("Hamlet asks a question")).toHaveLength(128);
	});
});

import type corpusManifest from "./generated/gutenberg-manifest.json";
import type { Attestation, SourceDocument, SourceSpan } from "./types";

export type CorpusManifest = typeof corpusManifest;

export type CorpusBrowserView =
	| { type: "docs" }
	| { type: "spans" }
	| { type: "claims" }
	| { type: "source"; sourceId: string };

export type ClaimRecord = {
	attestation: Attestation;
	span: SourceSpan;
	source: Pick<SourceDocument, "sourceId" | "title" | "kind" | "sourceUrl">;
};

export type CorpusBrowserResponse =
	| {
			type: "docs";
			manifest: CorpusManifest;
	  }
	| {
			type: "spans";
			total: number;
			spans: SourceSpan[];
	  }
	| {
			type: "claims";
			total: number;
			claims: ClaimRecord[];
	  }
	| {
			type: "source";
			source: SourceDocument | null;
	  };

export async function fetchCorpusBrowserView(
	view: CorpusBrowserView,
): Promise<CorpusBrowserResponse> {
	const params = new URLSearchParams({ view: view.type });

	if (view.type === "source") {
		params.set("sourceId", view.sourceId);
	}

	const response = await fetch(`/api/corpus?${params.toString()}`);

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `Corpus request failed with ${response.status}`);
	}

	return response.json() as Promise<CorpusBrowserResponse>;
}

import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import manifest from "#/features/attestations/generated/gutenberg-manifest.json";

const MAX_BROWSER_ITEMS = 500;

export const Route = createFileRoute("/api/corpus")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const view = url.searchParams.get("view") ?? "docs";
				const sourceId = url.searchParams.get("sourceId");
				const { corpus, findSource, listSpans } = await import(
					"#/features/attestations/corpus"
				);

				if (view === "docs") {
					return json({ type: "docs", manifest });
				}

				if (view === "spans") {
					const spans = listSpans();

					return json({
						type: "spans",
						total: spans.length,
						spans: spans.slice(0, MAX_BROWSER_ITEMS),
					});
				}

				if (view === "claims") {
					const claims = corpus.flatMap((source) =>
						source.spans.flatMap((span) =>
							span.attestations.map((attestation) => ({
								attestation,
								span,
								source: {
									sourceId: source.sourceId,
									title: source.title,
									kind: source.kind,
									sourceUrl: source.sourceUrl,
								},
							})),
						),
					);

					return json({
						type: "claims",
						total: claims.length,
						claims: claims.slice(0, MAX_BROWSER_ITEMS),
					});
				}

				if (view === "source") {
					return json({
						type: "source",
						source: sourceId ? (findSource(sourceId) ?? null) : null,
					});
				}

				return new Response("Unknown corpus view.", { status: 400 });
			},
		},
	},
});

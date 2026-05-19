import { getEmbeddingConfig } from "../src/features/attestations/embeddings.server";
import { populateSearchIndex } from "../src/features/attestations/search.server";

const startedAt = performance.now();
const config = getEmbeddingConfig();

console.log(
	`Populating span index with ${config.provider} embeddings (${config.model}, ${config.dimensions} dimensions).`,
);

await populateSearchIndex();

console.log(`Embedding index ready in ${Math.round(performance.now() - startedAt)}ms.`);

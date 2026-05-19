# Attestify Handoff

This handoff captures the current state of the prototype and the design language that came out of the citation/provenance discussion. Treat it as a grill-with-docs artifact: it records what is actually implemented, what decisions are intentional, and where the next engineer should push instead of polishing the wrong thing.

## Current State

Attestify is a TanStack Start prototype for citation over source-faithful attestations. It is not a generic chatbot over a vector database. The important move is that retrieval returns source spans, but the answer cites smaller semantic units that are anchored inside those spans.

The repo lives at `/Users/mikesmedes/attestify`.

The current corpus is generated from six Project Gutenberg sources:

- Hamlet
- Macbeth
- Crime and Punishment
- Pride and Prejudice
- The Adventures of Sherlock Holmes
- Alice's Adventures in Wonderland

The generated manifest reports 6 documents, 3,889 source spans, and 7,330 attestations. The generated corpus is checked in under `src/features/attestations/generated/`.

## Core Claim

The system should cite what a source expresses, not whatever raw chunk happened to be nearest in embedding space.

That does not mean the system decides whether the source is true. The document is the authority for citation purposes. If a document says a random string of digits or an internally inconsistent claim, the system's job is to produce a faithful citation to that source expression. Reconciliation belongs in answer synthesis and user-facing explanation, not in the citation substrate.

## What Exists

### App Shell

- TanStack Start generated app.
- React 19.
- TanStack Router and TanStack Query.
- Tailwind CSS 4.
- Biome for formatting/linting.
- Vitest for deterministic tests.
- `vitest-evals` for model-backed answer evals.

### Corpus Model

The main domain types are in `src/features/attestations/types.ts`.

The key types are:

- `SourceDocument`: a document-level authority.
- `SourceSpan`: a citeable raw source region with locator metadata.
- `Attestation`: a semantic statement extracted from a source span.
- `CitationUnit`: the returned citation object combining an attestation, its source document, its span, its citation handle, and source support metadata.
- `RetrievalChunk`: the broader retrieval unit used for recall.
- `SearchResponse`: the API response shape containing answer lines, citations, retrieval chunks, trace data, and corpus stats.

### Corpus Import

`scripts/import-gutenberg-corpus.mjs` fetches Project Gutenberg UTF-8 sources and writes:

- `src/features/attestations/generated/gutenberg-corpus.json`
- `src/features/attestations/generated/gutenberg-manifest.json`

This prototype currently uses generated public-domain text as a substitute for arbitrary corpora such as Notion docs, meeting transcripts, repair manuals, espresso guides, or scientific explainers.

### Retrieval

`src/features/attestations/search.server.ts` owns the retrieval layer.

The flow is:

1. Normalize the original query and any expanded retrieval queries.
2. Ensure the Vectra index exists under `.data/span-index`.
3. Embed queries using OpenAI embeddings when configured, or a deterministic local hash embedding fallback otherwise.
4. Combine vector scores with lexical overlap.
5. Retrieve broad source spans.
6. Expand retrieved spans into attestation-backed citation candidates.
7. Filter to source-verified citation units.
8. Return citations separately from raw retrieval chunks.

The important boundary: retrieval chunks help find evidence; citation units are what answers are allowed to cite.

### Embeddings

`src/features/attestations/embeddings.server.ts` supports two providers:

- `openai`: uses `text-embedding-3-small` by default, with cached vectors in `.data/span-embeddings.json`.
- `local-hash`: deterministic 128-dimensional token hash embedding used in tests or when OpenAI embeddings are unavailable/disabled.

The fallback is intentionally crude. It exists so local tests and basic retrieval can run without an API key. It should not be mistaken for a production retrieval strategy.

### Answer Pipeline

`src/features/attestations/answer.server.ts` owns the AI answer route.

When `OPENAI_API_KEY` is present, the route:

1. Expands the user query into literal retrieval queries.
2. Retrieves a broad candidate pool from Vectra plus lexical scoring.
3. Reranks citation units against the original question.
4. Asks the answer model to emit cited claims using only supplied evidence.
5. Hydrates citation markers with source quote, source title, section, locator, and source span text.
6. Records the completed run in local SQLite.

When `OPENAI_API_KEY` is missing, the answer route falls back to retrieval-only output and records a trace explaining that answer synthesis was unavailable.

### API Surface

Implemented API routes include:

- `POST /api/search`: retrieval and citation-unit search.
- `POST /api/answer`: full retrieval, rerank, answer synthesis, and history write.
- `GET /api/history`: recent query run summaries.
- `GET /api/history/:runId`: stored run detail.
- `GET /api/corpus`: corpus browsing data.

Request validation lives in `src/features/attestations/request.ts`. It normalizes whitespace, rejects malformed JSON, rejects short queries, and caps query length at 500 characters.

### History

`src/features/attestations/history.server.ts` stores completed runs in local SQLite at `.data/attestify.sqlite`.

Drizzle schema lives in `src/features/attestations/history.schema.ts`; the generated migration is checked in under `drizzle/`.

History is local and operationally useful, not a durable product-grade audit log yet. It stores the query, answer text, retrieval queries, chunks, citations, AI trace, and full response JSON.

### UI

The main UI lives under `src/features/attestations/components/`.

The UI exposes:

- Search/answer entry.
- Citation cards.
- Raw chunk panel.
- Evidence column.
- Corpus sidebar/browser.
- Query history.
- Answer trace panels.

The UI's purpose is diagnostic as much as presentational: it should let someone see whether a failure came from query planning, retrieval, reranking, answer synthesis, or citation anchoring.

## What Is Intentionally Not Solved

### Truth

This system does not adjudicate world truth. It records that a source span expresses an attestation. If two sources conflict, both can be cited faithfully. The answer layer may explain the discrepancy, but the citation layer should not erase it.

### Arbitrary Corpus Ingestion

The current corpus is public-domain text imported by a custom script. There is not yet a general ingestion interface for Notion, Granola, PDFs, repair manuals, web pages, or private document stores.

### LLM Extraction at Scale

The current attestation generation is not the final answer for private corpora. A naive "run an LLM over every document" approach will blow up on cost and operational complexity for million-document corpora.

The likely production shape needs a staged extractor:

1. Cheap structural segmentation.
2. Cheap lexical/entity/heading heuristics.
3. Lazy extraction for spans that users actually query.
4. Cached attestation generation.
5. Source-faithfulness verification.
6. Promotion of high-value attestations into an index.

### Strong Faithfulness Verification

The current support check is an anchor substring check: `anchorText` must appear inside the source span.

That is useful, but weak. It proves the quoted anchor is present. It does not prove that the full normalized attestation subject/predicate/value is a faithful semantic rendering of the span.

The next version needs a verifier that checks whether the attestation is entailed by the span, while still treating the document as authoritative for citation.

### Production-Grade Retrieval

Vectra is fine for a local prototype. It is not a serious production retrieval layer for large private corpora. It is being used here because it makes the prototype local and visible.

Production likely needs:

- A real vector store or hybrid search engine.
- Corpus-aware sharding.
- Incremental indexing.
- Deletion/update semantics.
- Tenant boundaries.
- Versioned source snapshots.
- Stable citation handles across reindexing.

### Stable Citation Identity

Current citation handles use `${attestation.id}#${span.spanId}`. That is good enough for generated local data. It is not sufficient for fast-moving corpora where documents mutate.

For Notion/Granola/private data, citation identity needs source versioning:

- Source connector.
- External source ID.
- Source version or content hash.
- Span locator.
- Attestation ID.
- Extraction version.

Without that, "citation" silently degrades into "whatever that span means today."

## Commands

Use Node 20.19+ or 22.12+. This machine has been using Node 23.5.0.

Recommended command prefix in this environment:

```bash
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run check
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run test
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run build
```

Corpus and embedding commands:

```bash
npm run import:corpus
npm run populate:embeddings
```

Built-server run path:

```bash
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run preview
```

Then open `http://localhost:3010/`.

`npm run preview` is the supported local preview path. It builds first, then
serves the built TanStack Start/Nitro output on port 3010. If the app is already
built, `npm run start:preview` starts only the server.

The plain dev server is currently not the verified path. `npm run dev` has hit
`EMFILE: too many open files, watch` on this machine.

Preview smoke test:

```bash
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run verify:preview
```

The smoke test starts the built server with `ATTESTIFY_OPENAI_DISABLED=true`,
`OPENAI_API_KEY=`, and `OPENAI_EMBEDDINGS=false`, then checks app-owned preview
behavior: app shell, retrieval-only answer fallback, citation/raw chunk data,
corpus browser data, and query history.

Manual browser verification checklist:

- Search/answer entry: submit `What is the mousetrap in Hamlet?`.
- Citation cards: verify source cards and citation handles appear in the
  evidence column.
- Raw chunks: verify retrieved source spans render in the raw chunk panel.
- Evidence column: open a citation and inspect title, section, locator, quote,
  and source text.
- Corpus browser/sidebar: open documents, spans, and claims from the sidebar.
- Query history: select a saved run and confirm it loads without a new query.
- Answer trace panels: without `OPENAI_API_KEY`, expect unavailable answer
  synthesis and a missing-key config trace.

OpenAI-enabled answer synthesis is credential-dependent and separate from the
no-key fallback. With `OPENAI_API_KEY` configured, repeat the browser path and
verify retrieval planning, reranking, answer synthesis, cited answer segments,
and trace panels.

## Environment

`.env.local` is ignored by git.

Useful variables:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-nano
OPENAI_EMBEDDINGS=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1024
ATTESTIFY_OPENAI_DISABLED=false
```

`OPENAI_EMBEDDINGS=false` forces the local hash embedding fallback.
`ATTESTIFY_OPENAI_DISABLED=true` forces retrieval-only behavior even when
`.env.local` contains OpenAI credentials.

## Tests and Evals

Deterministic tests cover:

- Corpus shape.
- Attestation anchors existing in source spans.
- Retrieval returning source-verified citations.
- Expanded retrieval query behavior.
- Request parsing and validation.
- Local hash embedding behavior.

Model-backed evals live in `src/features/attestations/answer.eval.ts` and are intentionally separate from normal tests because they spend model credits.

Run deterministic checks:

```bash
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run check
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run test
```

Run answer evals only when configured and intentionally spending credits:

```bash
PATH="/Users/mikesmedes/.nvm/versions/node/v23.5.0/bin:$PATH" npm run evals
```

## Known Risks

### The Dev Server Is Not Verified

The built Nitro server is the path documented in README. The Vite dev server has hit a local file descriptor watcher limit. Do not claim browser verification from `npm run dev` until that is fixed and checked in a browser.

Likely fixes to investigate:

- Raise `ulimit -n` for the shell running Vite.
- Reduce what Vite/TanStack watches.
- Confirm whether generated corpus size or `.data/` contributes to watcher pressure.
- Use the built Nitro server for demo until dev server is stable.

### The Attestation Extractor Is Too Naive for the Real Thesis

The prototype proves the shape, not the final extraction strategy. Arbitrary corpora need an extraction pipeline that can be lazy, cached, versioned, and verified.

Do not turn this into "LLM preprocesses every document up front." That is the expensive failure mode the original discussion was worried about.

### The Answer Model Can Still Overreach

The prompt says "answer only from supplied evidence," and citation handles are validated/hydrated server-side. That constrains answer output, but it does not prove the claim text is semantically entailed by cited evidence.

The next serious step is claim-level answer verification:

- Generated answer claim.
- Citation handles used by that claim.
- Source evidence for each handle.
- Verifier result: supported, contradicted, weak, or missing.

### Chunk Leakage

The raw chunks are still visible in the response for diagnostics. That is useful, but dangerous if future code starts citing retrieval chunks again. Keep the boundary explicit: chunks are retrieval artifacts, not citation artifacts.

### Source Updates

The current sources are static public-domain texts. Fast-moving startup knowledge bases are not static. For Notion plus Granola, every citation needs to answer "which version of the document/transcript did this come from?"

## Next Work

### 1. Fix Local Dev Verification

Make the dev server reliable or standardize on built-server local preview. Then verify the UI in a browser. Until that happens, the prototype is technically implemented but not fully product-verified.

### 2. Add a Real Ingestion Boundary

Create a connector-neutral ingestion contract:

- `SourceDocumentInput`
- `SourceSnapshot`
- `SourceSpanCandidate`
- `ExtractionRun`
- `AttestationCandidate`
- `VerifiedAttestation`

Do not start with Notion-specific types. Notion and Granola should be adapters into the same substrate.

### 3. Add Source Versioning

Every source span should carry:

- External source ID.
- Source version or content hash.
- Connector.
- Locator.
- Retrieved/imported timestamp.
- Optional author/workspace metadata.

Citation handles must be stable enough to resolve old answers after source documents change.

### 4. Separate Candidate Extraction from Promotion

Not every extracted statement should become a first-class indexed attestation. Add a promotion layer:

- Raw source span.
- Candidate attestations.
- Verification status.
- Confidence or quality score.
- Query/access frequency.
- Promotion state.

This is how the system avoids preprocessing a million private documents at full semantic depth before knowing what matters.

### 5. Implement Lazy Attestation Expansion

A practical path:

1. Index cheap spans for every source.
2. Retrieve likely spans for a user query.
3. Generate or refresh attestations only for those spans.
4. Verify and cache them.
5. Re-run citation selection over the newly expanded attestation set.

That makes citation quality improve where users apply pressure, without requiring total corpus understanding up front.

### 6. Build Conflict Surfaces

Because the system does not decide truth, conflicting attestations should be first-class:

- "Source A says X."
- "Source B says Y."
- "These are both source-faithful."
- "The answer model can summarize the discrepancy, but the citation layer preserves it."

This matters for startup knowledge bases where docs and transcripts disagree constantly.

### 7. Strengthen Evaluation

Add eval cases for:

- Conflicting source statements.
- Source updates/versioned citation handles.
- Granola-style transcript ambiguity.
- Notion docs with stale decisions.
- Queries where no source supports an answer.
- Queries where retrieval finds nearby context but no citeable attestation.

## What Not To Do

- Do not collapse attestations back into raw chunks.
- Do not call this a knowledge graph unless relations and identity are real.
- Do not treat "verified against source" as "true in the world."
- Do not let model-written claims enter the citation store without source anchoring.
- Do not hide the dev server watcher failure.
- Do not claim arbitrary-corpus support until ingestion, versioning, and lazy extraction exist.

## Product Thesis

The strongest framing is not "better RAG." It is "source-attested retrieval."

RAG retrieves text that may help answer. Attestify should retrieve and cite source-backed semantic assertions, while preserving a resolvable path back to the exact document version and text that expressed them.

That is the thing worth preserving as the prototype evolves.

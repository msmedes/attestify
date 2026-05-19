# PRD - Slice 02: Connector-Neutral Ingestion

## Problem Statement

Attestify currently proves source-attested retrieval against a generated Project Gutenberg corpus. That is useful for a prototype, but it does not define how arbitrary corpora enter the system. Without a connector-neutral ingestion boundary, the next implementation will likely bake Notion, Granola, PDFs, or one-off scripts directly into the core citation model.

That would collapse the product thesis. The substrate should be source-faithful attestations over versioned source snapshots, not a pile of adapter-specific records.

## Solution

Attestify gains a connector-neutral ingestion contract that accepts source documents from different systems, captures source snapshots, segments them into span candidates, and records extraction runs without coupling the core model to any one connector. Notion and Granola can later become adapters into the same substrate rather than special cases.

## User Stories

1. As a developer, I want a common ingestion input shape, so that every connector feeds the same citation substrate.
2. As a connector author, I want to submit a source document with connector metadata, so that external identity is preserved without leaking adapter details everywhere.
3. As a connector author, I want to submit a source snapshot, so that mutable documents can be cited by the version that produced the answer.
4. As a developer, I want source span candidates to be produced before attestations, so that segmentation can stay cheap and deterministic.
5. As a developer, I want extraction runs to be explicit records, so that generated attestations can be traced back to the source snapshot and extractor version.
6. As a developer, I want attestation candidates to be separated from verified attestations, so that model output does not become citeable just because it exists.
7. As a product reviewer, I want the existing Gutenberg corpus to be expressible through the same boundary, so that the prototype data path does not diverge from the future one.
8. As an evaluator, I want ingestion failures to be visible, so that malformed documents or missing locators do not silently produce empty citation results.
9. As a future privacy reviewer, I want connector-specific workspace and author metadata to be optional and scoped, so that the core model does not require private fields for public corpora.
10. As a maintainer, I want the contract to be small enough to test in isolation, so that ingestion can evolve without rewriting retrieval and answer synthesis.
11. As a developer, I want source kinds to remain descriptive but not authoritative, so that a document type does not imply truth semantics.
12. As a user, I want answers over imported sources to cite the document expression, so that Attestify remains a citation system rather than a truth oracle.

## Implementation Decisions

- Introduce an ingestion domain boundary with source document input, source snapshot, source span candidate, extraction run, attestation candidate, and verified attestation concepts.
- Keep connector-specific adapters outside the core citation and retrieval modules.
- Preserve existing terminology: source documents express attestations; retrieval chunks are recall artifacts; citation units are citeable output.
- Treat the current Gutenberg importer as an adapter candidate rather than the long-term ingestion architecture.
- Require locators on source span candidates. A span without a locator cannot become a useful citation.
- Record connector identity and external source identity separately from internal IDs.
- Keep source snapshot identity explicit even for static public-domain fixtures, so the model does not have a static-only blind spot.
- Avoid a full queue, worker, or sync scheduler in this slice. The boundary comes first.

## Testing Decisions

- Good tests for this slice validate app-owned ingestion normalization and rejection behavior, not framework or parser internals.
- Test that a valid source document input can produce source snapshot and span candidate records with stable internal identity.
- Test that missing external identity, missing locators, or empty content fail with clear errors.
- Test that the Gutenberg fixture path can be represented through the ingestion boundary or an equivalent compatibility layer.
- Do not write connector integration tests for Notion, Granola, PDFs, or web crawling in this slice.
- Do not write tests that only restate schema-library validation. Tests should cover the domain behavior around identity, snapshotting, and span candidacy.

## Out of Scope

- A production connector sync engine is out of scope; this slice defines the substrate.
- LLM extraction at scale is out of scope; this slice may name extraction runs but does not solve extraction strategy.
- Stable citation handle design is out of scope except for preserving the fields it will need.
- Production vector storage is out of scope; ingested spans may still feed the existing local retrieval path.

## Further Notes

Do not start with Notion-specific types. Notion and Granola are important motivating examples, but starting there would make the core model inherit adapter quirks before the substrate is clear.


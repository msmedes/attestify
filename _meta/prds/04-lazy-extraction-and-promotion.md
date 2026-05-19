# PRD - Slice 04: Lazy Extraction and Promotion

## Problem Statement

The prototype has checked-in attestations generated from a small public corpus. That proves the target shape, but it is not a viable path for large private corpora. A naive "run an LLM over every document up front" approach will blow up on cost, latency, rate limits, and operational complexity.

Attestify needs a staged extraction model where cheap span indexing creates broad recall, attestation extraction happens where user demand justifies it, verification gates promotion, and high-value attestations become indexed citation units.

## Solution

Attestify separates span indexing, attestation candidate extraction, source-faithfulness verification, cache storage, and promotion into explicit stages. Queries can trigger lazy attestation expansion for promising spans, then rerun citation selection over the enriched candidate set. The system improves citation quality where users apply pressure without pretending it understands the entire corpus up front.

## User Stories

1. As a user, I want first queries over a new corpus to return useful source-backed results, so that the system does not require full semantic preprocessing before use.
2. As a user, I want repeated queries in the same area to improve, so that extracted and verified attestations are reused.
3. As a developer, I want cheap span indexing to happen before expensive attestation extraction, so that large corpora are operationally feasible.
4. As a developer, I want candidate extraction to be separate from verified promotion, so that model-written claims cannot enter the citation store unchecked.
5. As a developer, I want extraction results cached by source snapshot and extraction version, so that costs are not repeatedly paid for unchanged spans.
6. As a developer, I want promotion state to be explicit, so that the system can distinguish raw candidates, verified candidates, promoted attestations, and rejected candidates.
7. As an evaluator, I want lazy expansion traces, so that I can see whether a query failed at retrieval, extraction, verification, or promotion.
8. As a maintainer, I want high-frequency spans to be promoted preferentially, so that indexing effort follows actual user demand.
9. As a user, I want no-answer behavior when nearby spans do not contain citeable attestations, so that the system does not cite context just because it was retrieved.
10. As a developer, I want extraction concurrency and limits to be bounded, so that one query cannot trigger unbounded model work.
11. As a reviewer, I want deterministic tests around the state machine, so that expensive model calls are not required to prove promotion behavior.
12. As a product owner, I want the prototype to keep the citation-unit boundary, so that lazy extraction does not regress into citing retrieval chunks.

## Implementation Decisions

- Add explicit lifecycle states for attestation candidates and promoted verified attestations.
- Treat raw source spans as cheap retrieval units and promoted attestations as citeable semantic units.
- Cache extraction results by source snapshot, span identity, extractor version, and relevant extraction settings.
- Add lazy attestation expansion after broad span retrieval and before final citation selection.
- Re-run citation selection after new verified candidates are available for the retrieved spans.
- Keep source-faithfulness verification as a promotion gate, even if the first verifier is weak.
- Add trace data that exposes extraction, verification, cache hit, and promotion behavior.
- Bound query-triggered extraction work by span count, token budget, concurrency, and timeout.
- Keep generated Gutenberg attestations as fixture data, but route future arbitrary corpora through the staged pipeline.

## Testing Decisions

- Good tests for this slice prove the extraction lifecycle, cache keys, promotion rules, and no-citation fallback behavior.
- Test that an unverified candidate cannot become a citation unit.
- Test that cached candidates are reused for unchanged source snapshots and invalidated when extraction version or source snapshot changes.
- Test that citation selection reruns after lazy expansion and can return newly promoted attestations.
- Test that query-triggered extraction respects configured limits.
- Use deterministic fake extractors and verifiers for unit tests; model-backed extraction evals belong outside normal test runs.
- Do not write tests that only prove the model can extract a statement from sample prose. The app-owned behavior is the pipeline and gating.

## Out of Scope

- A perfect semantic verifier is out of scope; this slice needs a verifier interface and promotion gate.
- Production vector store migration is out of scope; the pipeline can start against the current local retrieval layer.
- Full connector sync is out of scope; this slice assumes source snapshots and spans exist.
- Conflict UI is out of scope; conflicts may emerge from promoted attestations but are not rendered here.

## Further Notes

This is the main anti-cost slice. If implemented as "LLM preprocesses every document," it misses the point even if the API works.


# PRD - Slice 07: Production Retrieval and Evals

## Problem Statement

Vectra and generated Gutenberg data are fine for a local prototype, but they are not a production retrieval strategy for large private corpora. The current system also needs stronger evals for the cases that matter to source-attested retrieval: conflicts, source updates, transcript ambiguity, stale docs, no-support queries, and nearby-but-not-citeable retrieval results.

If retrieval is scaled without evals, Attestify can become a better vector search demo while regressing on its actual promise: cite source-backed semantic assertions.

## Solution

Attestify gains a production retrieval plan and eval suite that preserve the citation-unit boundary while preparing for larger corpora. The retrieval layer can evolve toward hybrid search, corpus-aware sharding, incremental indexing, deletion/update semantics, tenant boundaries, and versioned source snapshots, while evals guard against chunk leakage and unsupported answers.

## User Stories

1. As a user, I want relevant source-backed citation units from large corpora, so that answers remain grounded as data volume grows.
2. As a developer, I want retrieval evals that include no-support cases, so that nearby context does not become fake evidence.
3. As a developer, I want evals for source updates and versioned citation handles, so that mutable corpora do not break old answers silently.
4. As a developer, I want evals for conflicting source statements, so that answer synthesis preserves disagreement.
5. As a developer, I want evals for transcript ambiguity, so that spoken meeting data does not get treated like polished documentation.
6. As a developer, I want evals for stale decision docs, so that Notion-style knowledge bases reveal reconciliation needs.
7. As a maintainer, I want a retrieval abstraction that can move beyond Vectra, so that local prototype choices do not become production architecture by accident.
8. As an operator, I want incremental indexing and deletion semantics, so that private corpus changes are reflected without full reindexing.
9. As an operator, I want tenant and corpus boundaries, so that retrieval never crosses private data scopes.
10. As a reviewer, I want trace output for hybrid retrieval, so that vector, lexical, and citation-selection behavior can be debugged separately.
11. As a product owner, I want production retrieval work to keep citing citation units, so that scaling does not regress into chunk citation.
12. As an evaluator, I want model-backed evals to be opt-in and separate from deterministic tests, so that normal local checks remain cheap.
13. As a developer, I want retrieval quality metrics tied to citation quality, so that high recall does not mask weak or missing attestations.
14. As a user, I want clear no-answer behavior when retrieval finds related spans but no source-faithful attestation, so that the system stays honest.

## Implementation Decisions

- Keep the current local retrieval implementation as the prototype baseline while defining an abstraction for future production stores.
- Preserve hybrid retrieval: vector scores and lexical signals should remain inspectable rather than collapsed into an opaque rank.
- Add eval fixtures for conflicts, source updates, transcript ambiguity, stale docs, no-support queries, and nearby-but-not-citeable spans.
- Keep model-backed evals separate from normal deterministic tests.
- Add retrieval trace fields that can explain query planning, candidate spans, citation candidates, reranking, and no-citation outcomes.
- Treat tenant, corpus, deletion, update, and snapshot boundaries as production requirements, even if the first implementation remains local.
- Make citation quality the target metric. Retrieval chunks are useful only insofar as they lead to citeable source-faithful units.
- Avoid selecting a production search vendor in this PRD unless implementation starts and current constraints require the choice.

## Testing Decisions

- Good tests for this slice include deterministic retrieval cases plus opt-in model-backed evals for answer behavior.
- Test that related retrieval chunks without verified attestations produce no citeable answer.
- Test source-update behavior once versioned citation identity exists.
- Test conflict cases once conflict surfaces exist.
- Test deletion/update semantics when the retrieval abstraction supports mutable corpora.
- Keep vector-store-specific tests behind the retrieval abstraction unless the store behavior is app-owned.
- Do not make normal test runs depend on OpenAI credentials or model credits.

## Out of Scope

- Immediate migration away from Vectra is out of scope unless a dependent slice requires it.
- Full production connector ingestion is out of scope; retrieval consumes the ingestion substrate once it exists.
- Claim-level verifier implementation is out of scope, though evals should account for its output when available.
- Vendor procurement, hosting, and cost modeling are out of scope for this slice.

## Further Notes

The retrieval target is not "more similar chunks." It is "more reliable citation units." Any production retrieval work that optimizes chunk recall while weakening the citation boundary is a regression.


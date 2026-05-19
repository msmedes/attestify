# PRD - Slice 06: Conflict Surfaces

## Problem Statement

Attestify intentionally does not decide world truth. If two source documents disagree, both can produce source-faithful attestations. The current prototype can retrieve and cite units, but it does not make conflicting attestations a first-class user-facing concept.

Without conflict surfaces, answer synthesis may hide disagreement, flatten it into one claim, or appear to arbitrate truth when it is only citing source expressions.

## Solution

Attestify detects and surfaces conflicting source-faithful attestations as part of answer synthesis and diagnostics. The answer layer can summarize the discrepancy, but the citation layer preserves each source-backed expression and exposes which sources support which side.

## User Stories

1. As a user, I want to see when sources disagree, so that I do not mistake one cited claim for consensus.
2. As a user, I want the answer to say "Source A says X; Source B says Y" when appropriate, so that disagreement is understandable.
3. As a reviewer, I want conflict diagnostics to show the underlying citation units, so that I can inspect the source spans.
4. As a developer, I want conflict detection to operate on attestations, not raw chunks, so that retrieval context does not become false evidence.
5. As a developer, I want conflict grouping to be conservative, so that unrelated statements are not forced into a false contradiction.
6. As a developer, I want answer synthesis to receive conflict context, so that it can reconcile without deleting either source-faithful record.
7. As a user, I want no-conflict answers to stay concise, so that the UI does not add noise when sources align or only one source exists.
8. As an evaluator, I want fixtures for stale docs versus newer transcripts, so that startup-knowledge disagreement is tested explicitly.
9. As a maintainer, I want conflict surfaces stored in history, so that a later reviewer can see what disagreement existed at answer time.
10. As a product owner, I want the UI copy to avoid truth-arbitration language, so that Attestify does not claim to know which source is correct.
11. As a developer, I want conflict detection to tolerate partial evidence, so that weak or missing support does not become a confident contradiction.
12. As a user, I want each side of a conflict to remain citeable, so that I can go back to the source text myself.

## Implementation Decisions

- Add a conflict representation over citation units or verified answer claims, not retrieval chunks.
- Group potential conflicts by normalized subject and compatible predicate/value dimensions where the domain model supports it.
- Keep the first implementation conservative: detect obvious literal or structured disagreement before attempting broad semantic contradiction.
- Pass conflict groups into answer synthesis and trace output.
- Render conflicts in the diagnostic UI with source titles, locators, attestation summaries, and citation handles.
- Store conflict groups in query history.
- Preserve both sides of a conflict as source-faithful unless claim-level verification marks an answer claim unsupported.
- Avoid language that implies the system has decided which source is true.

## Testing Decisions

- Good tests for this slice prove obvious conflicts are surfaced and non-conflicts are not over-grouped.
- Test conflicting source statements from two documents, including stale decision docs versus newer transcript-like sources.
- Test that conflict groups contain citation units and do not cite raw retrieval chunks.
- Test that history detail preserves conflict groups.
- Test UI rendering with no conflicts, one conflict, and multiple conflict groups.
- Use deterministic fixtures for conflict grouping; model-backed contradiction evals can be separate.
- Do not test philosophical truth arbitration because that is explicitly not the system contract.

## Out of Scope

- Deciding which source is correct is out of scope.
- General knowledge graph construction is out of scope.
- Full semantic contradiction detection across arbitrary prose is out of scope for the first conflict surface.
- Ingestion of Notion or Granola data is out of scope; use fixtures that resemble those sources.

## Further Notes

Conflict handling is not a polish feature. It preserves the core claim that the citation layer records what sources express while the answer layer explains discrepancies.


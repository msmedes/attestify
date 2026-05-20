# PRD - Slice 08: Agentic Evidence Loop

## Problem Statement

The current agentic query mode improves retrieval by asking a model to produce exact phrases and semantic search queries before the normal answer pipeline runs. That helped, but it is still a one-shot planning step followed by a fixed workflow.

Hard questions often fail for reasons that are only visible after the first search: the model may need to inspect retrieved spans, follow an exact phrase, trigger lazy extraction for a promising source area, discard weak evidence, or try a narrower query. A static plan cannot react to those intermediate results.

Attestify needs adaptive evidence gathering without weakening its core source-faithfulness guarantees. The model may choose where to look next, but it must not decide which generated candidates become promoted citations or which answer claims are safe to show as supported.

## Solution

Agentic query mode becomes a bounded evidence loop. For each answer request, the system lets the model compose a small set of typed evidence actions, observes the results, and decides whether to continue, stop with enough evidence, or stop because source-supported evidence is insufficient.

From the user's perspective, agentic mode should feel better at difficult source-grounded questions: it can refine its search, inspect promising source spans, run lazy extraction where useful, and return a trace explaining how it reached enough evidence or why it stopped. The user still sees source-backed citations, claim verification status, and honest no-answer behavior when the loop cannot establish support.

## User Stories

1. As a user, I want agentic mode to refine its evidence search after seeing initial results, so that difficult questions are not limited by one upfront query plan.
2. As a user, I want the system to inspect promising source areas before answering, so that it does not miss evidence that requires a narrower follow-up.
3. As a user, I want the system to say when it cannot find enough source-supported evidence, so that it does not fill gaps with generic synthesis.
4. As a user, I want final citations to resolve to source text, so that adaptive search does not weaken citation trust.
5. As a reviewer, I want the trace to show each loop iteration, action, result summary, and stop reason, so that I can diagnose whether failure came from search, extraction, verification, or budget exhaustion.
6. As a reviewer, I want to distinguish evidence the agent considered from citations the host selected, so that intermediate scratchpad text cannot be mistaken for supported output.
7. As a developer, I want the model to call a small typed evidence API, so that the loop is adaptive without granting arbitrary execution or hidden state mutation.
8. As a developer, I want hard budgets on iterations, model calls, extraction calls, retrieved spans, and elapsed time, so that one query cannot trigger unbounded work.
9. As a developer, I want host code to retain authority over candidate promotion, citation selection, answer claim verification, and history persistence, so that source-faithfulness remains enforceable.
10. As a developer, I want loop behavior testable with deterministic fake tools and fake planners, so that normal tests do not depend on model quality or network calls.
11. As an evaluator, I want stop reasons and budget usage stored with history, so that agentic regressions can be compared across runs.
12. As a product owner, I want the adaptive loop to reuse existing retrieval and lazy extraction primitives, so that this slice improves evidence gathering without becoming a full answer-pipeline rewrite.
13. As a maintainer, I want malformed or repeated model actions to fail closed, so that a bad loop plan produces a traceable no-answer or fallback rather than unsafe output.
14. As a user without OpenAI configured, I want existing retrieval-only fallback behavior to remain intact, so that local verification paths do not require model credentials.

## Implementation Decisions

- Add an `EvidenceLoop` module that owns loop iteration, model planning, budget accounting, stop reasons, and loop trace construction.
- Add an `EvidenceTools` boundary that exposes only typed host actions the model may request. Initial tools should cover span search, span inspection, lazy extraction over selected spans, citation candidate selection, and explicit stop.
- Treat the loop's planner output as a requested action, not as an authoritative result. Host code validates every action, enforces budgets, executes allowed tools, and records rejected actions in the trace.
- Replace the one-shot agentic retrieval planner in agentic mode with the evidence loop. Hybrid mode should keep the existing direct retrieval behavior.
- Keep answer synthesis downstream of evidence gathering. The answer model should receive selected, hydrated citation units rather than the full loop scratchpad.
- Keep claim verification downstream of answer synthesis. The safe-answer boundary remains the existing verified-claim enforcement, not the evidence loop's own judgment.
- Keep lazy extraction as a host tool over retrieved or inspected spans. The model may request extraction, but only verified promoted candidates can become citation units.
- Represent loop completion with explicit stop reasons such as enough evidence, insufficient evidence, budget exhausted, invalid action, tool error, and model unavailable.
- Extend the trace shape with an agentic evidence loop stage that records iteration number, requested action, validated action, result summary, budget usage, and stop reason.
- Store loop trace and budget metadata in query history through the existing response persistence path.
- Bound the first implementation conservatively: small max iterations, small extraction-call count, small inspected-span count, and a wall-clock timeout. Defaults should be easy to tune but not user-controlled in this slice.
- Preserve current agentic exact-phrase behavior as one possible search action or initial planner hint, not as a separate pipeline branch.
- The invariant for this slice: no model-produced candidate is user-visible or citation-promoted unless host code verifies it against source evidence and the downstream answer-claim gate marks the final claim safe.

## Testing Decisions

- Unit-test `EvidenceLoop` with deterministic fake planners and fake tools. Good tests prove action validation, budget exhaustion, stop reasons, repeated-action handling, and trace shape.
- Unit-test that a model-requested lazy extraction cannot promote unverified candidates into final citation units.
- Unit-test that answer synthesis receives only selected citation units, not raw loop scratchpad or rejected candidate text.
- Unit-test that malformed planner output fails closed with an explicit traceable stop reason.
- Add integration coverage for agentic mode showing that a follow-up search or extraction action can improve the final citation set compared with the first retrieval pass.
- Extend history compatibility tests to accept persisted loop trace and budget metadata without breaking older runs.
- Extend UI trace tests only enough to prove loop iterations and stop reasons render distinctly. Avoid testing visual styling beyond the diagnostic states.
- Keep model-backed evals outside normal unit tests. They are useful for comparing agentic retrieval quality, but the app-owned behavior is the bounded loop and enforcement boundary.
- Keep existing retrieval-only fallback tests passing without OpenAI credentials.

## Out of Scope

- Arbitrary code execution tools are out of scope. The loop only receives a small evidence API.
- A general-purpose multi-agent framework is out of scope. This slice is a single bounded evidence loop inside answer generation.
- User-configurable budgets are out of scope. Defaults can be tuned by maintainers after observing behavior.
- Production vector store changes are out of scope. The loop should reuse the current retrieval/indexing layer.
- New connector ingestion work is out of scope. The loop assumes source snapshots and spans already exist.
- Conflict UI redesign is out of scope. If the loop finds conflicting evidence, existing or later conflict surfaces should handle presentation.
- Full prompt optimization and model selection evals are out of scope except where a minimal planner prompt is required to drive the loop.

## Further Notes

This slice is easy to overbuild. The point is not to make Attestify "more agentic" as a product claim. The point is to make evidence acquisition adaptive while keeping support policy boring, typed, and enforceable.

The most important design boundary is authority. The model can choose evidence actions; host code decides what counts as verified, promoted, selected, persisted, and safe to render.

If evals show that failures are mostly caused by weak first-pass query planning, this loop may be more machinery than needed. If failures are caused by missed follow-up inspection or extraction opportunities, this loop becomes the right abstraction.

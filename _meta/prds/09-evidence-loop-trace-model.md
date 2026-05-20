# PRD - Slice 09: Evidence Loop Trace Model

## Problem Statement

Agentic mode now runs a real autonomous evidence loop, but the trace still describes that loop with a flat stage list. Retrieval appears as a sibling stage before the evidence-loop summary, even when retrieval was invoked by a specific loop iteration. The UI therefore answers "what happened?" but not "which loop action caused this retrieval, extraction, budget change, or stop reason?"

That ambiguity matters because the evidence loop is now the core debugging surface for agentic behavior. When a Hamlet question stops early, exhausts budget, or gathers weak evidence, the owner needs to see whether the failure came from the model choosing a bad action, the host rejecting an action, retrieval returning weak spans, extraction failing to promote candidates, or downstream claim verification downgrading support.

The current trace is usable but not proud-of-it. It is too easy to misread the order of operations, and the raw chunk panel remains detached from the loop iteration that produced those chunks.

## Solution

Make the evidence loop trace a first-class nested diagnostic model. The loop should own its child tool events, and the UI should present each iteration as an action with its concrete results: search queries and returned chunks, inspected spans, extraction attempts, citation changes, budget deltas, and stop decisions.

From the user's perspective, agentic mode should show a coherent timeline: the loop started, it searched, retrieval returned spans, it optionally inspected or extracted, it stopped for a specific reason, then rerank/synthesis/claim verification ran. Retrieval should no longer look like a separate phase that happened before the loop when it was actually a tool call inside the loop.

This slice is about trace shape, rendering, and verification. It should not change retrieval quality, answer synthesis policy, or the autonomous tool loop's core behavior except where trace emission needs clearer boundaries.

## User Stories

1. As a product owner, I want the trace to show retrieval nested under the evidence-loop iteration that requested it, so that agentic behavior is not misrepresented as a fixed pipeline.
2. As a developer, I want each evidence-loop iteration to expose the requested action, validated action, result, rejection reason, and budget usage, so that failures can be diagnosed without reading server logs.
3. As a developer, I want retrieval chunks produced by a search action to be associated with that action, so that I can connect queries to the spans they returned.
4. As a developer, I want extraction attempts to show attempted span IDs, verified candidate counts, rejected candidate counts, and promoted attestation IDs, so that lazy extraction failures are visible.
5. As a developer, I want inspected spans to be shown as considered evidence, not as final citations, so that scratchpad evidence cannot be mistaken for support.
6. As a reviewer, I want the trace to distinguish host validation from model intent, so that invalid or repeated actions are visibly host-rejected.
7. As a reviewer, I want budget consumption to be visible per iteration and in aggregate, so that budget-exhausted runs explain what consumed the budget.
8. As a user, I want the raw retrieved chunks panel to remain available, so that I can inspect source text regardless of whether the chunks came from hybrid retrieval or agentic search.
9. As a user, I want the evidence-loop card to stay scannable on real runs with many chunks, so that the trace does not become an unreadable JSON dump.
10. As a maintainer, I want persisted history to remain readable for older runs, so that changing the trace model does not break saved query pages.
11. As a maintainer, I want the UI rendering to tolerate missing nested fields from legacy traces, so that existing history records degrade cleanly.
12. As an evaluator, I want model-call counts, tool-call counts, and stop reasons to remain machine-readable, so that eval output can compare loop behavior across runs.
13. As a developer, I want tests to prove trace chronology and nesting, so that future changes do not reintroduce the misleading "loop followed by retrieval" presentation.
14. As a developer, I want this slice to avoid changing answer eligibility rules, so that any improvement or regression in answer quality can be attributed to separate evidence-loop work.

## Implementation Decisions

- Introduce an explicit nested event shape for evidence-loop iterations. Each iteration should be able to contain child events for search/retrieval, inspection, extraction, and stop handling.
- Keep a compatibility path for the current flat trace shape. Existing saved runs should still render without migration, even if they cannot show nested child events.
- Treat retrieval traces emitted inside autonomous search as child events of the evidence loop, not as top-level sibling stages. Non-agentic or hybrid retrieval can remain a top-level retrieval stage.
- Preserve the current aggregate evidence-loop fields: stop reason, total budget usage, considered evidence, and per-iteration action summaries. The nested model should enrich those fields, not replace the high-signal summary.
- Add per-iteration budget snapshots or deltas. The final aggregate budget remains useful, but it is not enough to explain which action consumed the budget.
- Keep raw retrieval chunks as source data for the answer response. The trace model should reference returned chunks by stable span identity and compact summaries rather than duplicating unbounded source text everywhere.
- Update the trace timing model so nested tool events can still contribute to the waterfall without requiring every UI surface to understand tree layout. A flattened timing list is acceptable if labels make parentage explicit.
- Update the evidence-loop trace UI to render a tree-like timeline: loop summary, iteration rows, action-specific result details, then optional compact links to retrieved chunks, inspected spans, extraction results, and citation handles.
- Keep general non-loop trace cards available for rerank, answer synthesis, claim verification, config, and legacy retrieval-plan traces.
- Use the current visual language rather than a redesign: dense diagnostic panels, compact badges, tabular numbers, and details disclosure for verbose JSON.
- Do not expose raw model messages or hidden prompts in the trace. The trace should explain behavior without leaking prompt internals or unnecessary scratchpad.
- Add a small normalization layer for trace rendering so the React component is not full of ad hoc checks for old and new shapes.

## Testing Decisions

- Unit-test the evidence-loop trace builder or normalizer with deterministic fake loop events. Good tests prove chronology, parent-child association, budget snapshots, and rejection rendering.
- Unit-test that a search action's retrieval child event is nested under the iteration that requested it, not emitted as a top-level retrieval step in agentic mode.
- Unit-test legacy trace rendering with the existing flat `EvidenceLoopTraceStep` shape, so saved history remains readable.
- Add component tests for the evidence-loop trace card that verify stop reason, budget metrics, action labels, nested retrieval summaries, inspection summaries, and extraction summaries render distinctly.
- Add a regression test for the specific confusing case: an agentic Hamlet run should present evidence-loop before/around retrieval in the trace hierarchy rather than retrieval as an unrelated preceding stage.
- Keep model-backed evals out of this slice. They can validate whether autonomy improves answer quality, but this slice is about trace correctness and diagnostic UX.
- Do not snapshot large JSON blobs. Prefer targeted assertions on labels, counts, stop reasons, and nesting semantics.
- Do not write tests that only prove React can render static arrays. Tests should protect the app-owned mapping from trace data to diagnostic meaning.

## Out of Scope

- Improving retrieval ranking is out of scope. This slice only makes retrieval actions and results easier to inspect.
- Changing answer-synthesis or claim-verification policy is out of scope. Weak-support Hamlet answers should be handled in a separate verification-quality slice.
- User-configurable evidence budgets are out of scope. This slice may display budgets more clearly but should not add controls for them.
- A complete trace database migration is out of scope. Backward-compatible rendering is enough unless saved history proves impossible to read.
- A general observability system is out of scope. This is an in-app diagnostic trace for the answer flow, not OpenTelemetry instrumentation.
- Prompt editing, model selection, and planner strategy changes are out of scope except where existing trace data needs clearer names.

## Further Notes

The main risk is conflating chronology with hierarchy. A timing waterfall can stay flat because it answers "how long did each operation take?" The evidence-loop trace should be hierarchical because it answers "why did this operation happen?"

The next implementation issues should likely be split this way:

1. Define the nested evidence-loop trace contract and compatibility normalizer.
2. Emit nested retrieval, inspection, extraction, and budget events from the autonomous loop.
3. Update the trace UI to render the nested loop timeline and legacy traces.
4. Add focused tests for trace chronology, history compatibility, and the Hamlet-style diagnostic path.

Do not use this slice as an excuse to rework the whole trace system. The narrow target is that a person looking at an agentic run can tell which autonomous action produced which evidence and why the loop stopped.

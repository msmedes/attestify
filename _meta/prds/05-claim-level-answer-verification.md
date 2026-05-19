# PRD - Slice 05: Claim-Level Answer Verification

## Problem Statement

The answer route asks the model to answer only from supplied evidence, and citation handles are validated and hydrated server-side. That constrains the model, but it does not prove the generated claim text is semantically supported by the cited evidence.

The dangerous failure mode is an answer that uses real citation handles but overstates, combines, or distorts what those sources express. The citation layer can be source-faithful while the answer layer still overreaches.

## Solution

Generated answer claims are verified against the citation units they reference before being presented as supported. Each claim receives a support status such as supported, contradicted, weak, or missing. The UI and history expose that status so a reviewer can distinguish valid source-backed answers from claims that need correction or suppression.

## User Stories

1. As a user, I want cited answer claims to be checked against their cited evidence, so that citations cannot be decorative.
2. As a user, I want unsupported claims to be omitted or clearly marked, so that I do not act on overreaching synthesis.
3. As a reviewer, I want each answer claim to list the citation handles used for verification, so that I can inspect the evidence path.
4. As a reviewer, I want statuses for supported, contradicted, weak, and missing support, so that not all failures collapse into one generic error.
5. As a developer, I want verification to run after answer synthesis and citation hydration, so that it checks the exact evidence presented to the user.
6. As a developer, I want verification failures to be represented in trace data, so that debugging can separate retrieval failure from synthesis overreach.
7. As a developer, I want server-side enforcement, so that the UI is not responsible for deciding whether a claim is supported.
8. As an evaluator, I want fixtures where the model uses a real handle for a wrong claim, so that the verifier catches citation laundering.
9. As a user without model credentials, I want retrieval-only fallback behavior to remain available, so that verification does not break local no-key use.
10. As a maintainer, I want verification records stored in query history, so that old answer behavior can be audited.
11. As a product owner, I want the language to remain source-faithful, so that "verified" does not imply world truth.
12. As a developer, I want verifier strictness to be configurable for evals, so that model-backed verification can improve without destabilizing deterministic tests.

## Implementation Decisions

- Add an answer-claim verification stage after answer synthesis.
- Represent each generated claim as text plus citation handles plus verification result.
- Verify against hydrated citation-unit evidence, including attestation text, anchor quote, source span text, source title, locator, and source snapshot identity when available.
- Treat missing or unknown citation handles as verification failures.
- Store verification results in trace data and query history.
- Render verification status in the diagnostic UI without turning it into a world-truth label.
- Make the server decide which claims are safe to present as supported.
- Keep retrieval-only fallback intact when OpenAI answer synthesis is unavailable.
- Prefer a small verifier interface so deterministic tests can use a fake verifier and evals can use a model-backed verifier.

## Testing Decisions

- Good tests for this slice prove that unsupported or missing-evidence claims do not render as normal supported answer claims.
- Test that claims with invalid citation handles fail verification.
- Test that verification results are stored in trace and history output.
- Test that retrieval-only fallback does not require claim verification.
- Test that supported, weak, contradicted, and missing statuses can flow through the API response shape and UI diagnostics.
- Keep model-backed verifier quality in evals, not normal deterministic tests.
- Do not write tests that merely prove a schema accepts the status enum; test response behavior and enforcement.

## Out of Scope

- World-truth adjudication is out of scope; verification means supported by cited source evidence.
- Conflict reconciliation is out of scope; this slice verifies individual generated claims.
- Ingestion and source versioning are out of scope except where citation evidence already exposes version metadata.
- Full prompt redesign is out of scope unless current prompts prevent verification from receiving structured claims.

## Further Notes

This slice protects against citation laundering: the model cites something real, but the claim attached to it is not what the evidence says.


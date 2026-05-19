# PRD - Slice 01: Local Verification Path

## Problem Statement

Attestify has a working prototype shape, but the local development verification path is not trustworthy yet. The documented Vite dev server can hit a local `EMFILE: too many open files, watch` failure, so a developer can pass deterministic checks and still be unable to honestly say they saw the UI working in a browser.

This matters because Attestify is diagnostic as much as presentational. A broken or unverified local UI hides whether failures come from query planning, retrieval, reranking, answer synthesis, citation anchoring, or rendering.

## Solution

A developer can run one documented local preview path, open the app, submit representative queries, inspect citations, raw chunks, answer traces, corpus browsing, and query history, and know which server mode is supported. If the dev server remains unsupported on this machine, the app should make the built Nitro preview path explicit and repeatable instead of pretending `npm run dev` is verified.

## User Stories

1. As a developer, I want one documented command path for local preview, so that I can verify the product without guessing which server mode works.
2. As a developer, I want the app to build before previewing, so that browser verification reflects production-like output.
3. As a developer, I want the preview server to bind to a predictable port, so that screenshots, manual QA, and handoffs can refer to one URL.
4. As a developer, I want failures from unsupported dev-server watching to be documented honestly, so that I do not waste time debugging UI behavior behind an infrastructure failure.
5. As a reviewer, I want manual verification steps for the main diagnostic panels, so that a change is not called done after only type and unit checks.
6. As a reviewer, I want the browser check to cover the no-API-key fallback path, so that local contributors without credentials can still validate basic retrieval behavior.
7. As a reviewer, I want the browser check to cover the OpenAI-enabled path when credentials exist, so that answer synthesis and trace rendering are exercised deliberately.
8. As a developer, I want `.data` and generated corpus behavior understood in relation to watch pressure, so that the failure mode is not rediscovered every time the repo is opened.
9. As a maintainer, I want CI-style deterministic checks to remain separate from manual browser validation, so that automated confidence and visual confidence are not conflated.
10. As a future implementer, I want the README and handoff language to agree, so that downstream agents do not claim verification from a stale command.

## Implementation Decisions

- Add a first-class local preview workflow centered on the built server unless the Vite dev server is repaired and verified.
- Keep deterministic checks as `check`, `test`, and `build`; treat browser preview as a separate validation step.
- If the Vite dev server is repaired, document the actual fix and the remaining machine assumptions instead of just raising file descriptor limits ad hoc.
- Verify the main diagnostic panels: search/answer entry, citation cards, raw chunks, evidence column, corpus browser/sidebar, query history, and answer trace panels.
- Preserve the distinction between retrieval-only behavior and OpenAI-enabled answer synthesis.
- Do not make the prototype depend on a checked-in `.env.local`; local environment variables remain developer-owned.
- Prefer a small script or documented command sequence over hidden tooling that obscures what server is running.

## Testing Decisions

- Good tests for this slice prove the supported preview path starts after a build and returns the application shell.
- Automated tests should not attempt to prove visual quality; that remains a browser QA checklist or screenshot-driven verification.
- Existing deterministic tests for request parsing, retrieval, corpus shape, and embeddings should continue to run as the baseline.
- Add no tests that merely assert Vite, Nitro, or the OS file descriptor behavior. The app-owned behavior is the documented and repeatable verification path.
- If a smoke test is added, it should make one API request or load one route against the built server and fail clearly when the preview path breaks.

## Out of Scope

- Fixing retrieval quality is out of scope; this slice only makes verification honest and repeatable.
- Redesigning the UI is out of scope; this slice verifies the existing diagnostic surface.
- Production deployment is out of scope; this is local preview and review readiness.
- Changing the corpus model is out of scope; generated Gutenberg data remains the current fixture corpus.

## Further Notes

Do not hide the dev-server watcher failure. Either fix it and prove it in a browser, or standardize on the built-server path until there is a real reason to invest in the dev-server path.


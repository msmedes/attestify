# Attestify

A TanStack Start prototype for source-faithful citations over a real imported corpus. It imports public-domain Project Gutenberg texts, segments raw text into citeable spans, generates sentence/passage attestations with exact anchors, indexes the spans in Vectra, reranks broad evidence candidates, and returns citation units rather than arbitrary RAG chunks.

## License

This project is source-available for local evaluation only. You may clone,
install, build, and run the app locally, but you may not use it commercially or
in commercial processes, including internal business operations, client work,
revenue-generating workflows, commercial analysis, reports, datasets, products,
services, or decision-making. You also may not host it for others, redistribute
it, publish modified versions, or create derivative works without prior written
permission.

See [LICENSE](./LICENSE) for the full terms.

The current generated corpus is built from:

- Hamlet
- Macbeth
- Crime and Punishment
- Pride and Prejudice
- The Adventures of Sherlock Holmes
- Alice's Adventures in Wonderland

## Import Corpus

```bash
npm run import:corpus
```

This fetches Project Gutenberg UTF-8 text files and writes `src/features/attestations/generated/gutenberg-corpus.json`.

## Run

Use Node 20.19+ or Node 22.12+. This machine was verified with Node 23.5.0.

```bash
npm install
npm run import:corpus
npm run preview
```

Then open `http://localhost:3010/`.

`npm run preview` is the supported local preview path. It builds first, then
serves the built TanStack Start/Nitro output on port 3010. If you only need to
start an already-built server, use `npm run start:preview`.

To smoke-test the same built preview path without an OpenAI key:

```bash
npm run verify:preview
```

The smoke test builds the app, starts the built server on `http://localhost:3010`,
sets `ATTESTIFY_OPENAI_DISABLED=true`, `OPENAI_API_KEY=`, and
`OPENAI_EMBEDDINGS=false`, then checks the app shell, retrieval-only answer
fallback, corpus browser endpoint, citation/raw chunk data, and query history
write.

## Environment

Put local secrets in `.env.local`; it is ignored by git.

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-nano
OPENAI_EMBEDDINGS=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1024
ATTESTIFY_OPENAI_DISABLED=false
```

`OPENAI_MODEL` defaults to `gpt-5.4-nano` when omitted.

`OPENAI_EMBEDDINGS` defaults to enabled when `OPENAI_API_KEY` is present. Set
`OPENAI_EMBEDDINGS=false` to use the local deterministic hash embedding fallback
instead of calling OpenAI.

Set `ATTESTIFY_OPENAI_DISABLED=true` to force the retrieval-only local fallback
even when `.env.local` contains OpenAI credentials.

## Answer Pipeline

The AI answer route is intentionally split into traceable stages:

1. Expand the user query into literal retrieval queries.
2. Retrieve a broad candidate pool from Vectra plus lexical scoring.
3. Rerank candidate citation units against the original question.
4. Ask the answer model to emit cited claims using only the reranked evidence.
5. Render numbered citation markers that open the linked source quote.

The UI exposes each stage in the AI trace so a bad answer can be diagnosed as a
planning, retrieval, reranking, or synthesis failure.

## History

Completed answer runs are stored in local SQLite at `.data/attestify.sqlite`.
The schema lives in `src/features/attestations/history.schema.ts` and is wired
through Drizzle. The app creates the table automatically on first use, and the
generated migration is checked in under `drizzle/`.

To regenerate Drizzle migrations after changing the history schema:

```bash
npm run db:generate
```

The app exposes `GET /api/history` for recent run summaries and
`GET /api/history/:runId` for a stored run. Selecting a history item in the UI
loads the saved response into the main pane instead of rerunning the query or
spending model credits. Each stored run includes the query, answer text,
retrieval queries, retrieved chunks, citations, AI trace, and full response JSON.

## Populate Embeddings

The first search against a fresh checkout builds the Vectra index. With OpenAI
embeddings enabled, that first request embeds every generated span and writes a
cache to `.data/span-embeddings.json`. For the current corpus this is 3,889 spans,
so expect the first request to take roughly 1-2 minutes depending on network and
rate limits. Later requests reuse the cached vectors and should be much faster.

Recommended first-run flow:

```bash
npm install
npm run import:corpus
npm run populate:embeddings
npm run build
PORT=3010 node .output/server/index.mjs
```

`npm run populate:embeddings` is the explicit upsert/indexing step. It embeds
the generated corpus and writes the Vectra index before the app starts serving
queries.

The script logs a rebuild event like:

```text
[attestation-rag:retrieval] {"event":"rebuild-index","embeddingConfig":{"provider":"openai","model":"text-embedding-3-small","dimensions":1024},"spans":3889}
```

Embedding/index caches live under `.data/`:

- `.data/span-embeddings.json` caches OpenAI vectors for corpus spans.
- `.data/span-index/` is the Vectra index.
- `.data/span-index-config.json` records the embedding provider/model/dimensions.

If you change `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS`, or the
corpus, the app rebuilds the index on the next search. If you want a fully clean
rebuild, delete `.data/` and run the first search again.

## Develop

```bash
npm run dev
```

On this machine, the Vite dev server currently hits the local file-descriptor
limit, so `npm run dev` is not the verified path. Use `npm run preview` for
local browser verification until the watcher failure is fixed and checked in a
browser.

## Browser Verification

Use `npm run preview`, open `http://localhost:3010/`, and verify these panels
before claiming UI/browser coverage:

- Search/answer entry: submit `What is the mousetrap in Hamlet?`.
- Citation cards: confirm the evidence column fills with source cards and
  citation handles.
- Raw chunks: confirm retrieved source spans render in the raw chunk panel.
- Evidence column: open at least one citation and check title, section, locator,
  quote, and source text are present.
- Corpus browser/sidebar: open the documents, spans, and claims views from the
  sidebar.
- Query history: confirm the submitted query appears, then select it and verify
  the saved run loads without re-submitting.
- Answer trace panels: confirm the trace explains each stage. Without
  `OPENAI_API_KEY`, the expected answer synthesis state is unavailable with a
  missing-key config trace.

OpenAI-enabled answer synthesis is a separate credential-dependent check. With
`OPENAI_API_KEY` configured, run the same browser path and verify retrieval
planning, reranking, answer synthesis, cited answer segments, and trace panels.
Do not treat that as part of the no-key local fallback.

## Test

```bash
npm run check
npm run test
npm run build
```

Generated-answer evals use `vitest-evals` and call the configured OpenAI model:

```bash
npm run evals
```

The eval suite is separate from `npm test` so normal deterministic tests do not
spend model credits. Current evals assert that generated answers are ready,
include rerank traces, and cite expected source anchors for representative
questions.

The VectorDB files are generated under `.data/` and are intentionally ignored.

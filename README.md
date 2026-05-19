<img width="1496" height="1506" alt="image" src="https://github.com/user-attachments/assets/f33b6c83-c419-4330-8fbb-a3313bd3ffc3" />

# Attestify

A TanStack Start prototype for source-faithful citations over a real imported corpus. It imports public-domain Project Gutenberg texts, segments raw text into citeable spans, generates sentence/passage attestations with exact anchors, indexes the spans in Vectra, and returns citation units rather than arbitrary RAG chunks.

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
npm run build
PORT=3010 node .output/server/index.mjs
```

Then open `http://localhost:3010/`.

## Environment

Put local secrets in `.env.local`; it is ignored by git.

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-nano
OPENAI_EMBEDDINGS=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1024
```

`OPENAI_MODEL` defaults to `gpt-5.4-nano` when omitted.

`OPENAI_EMBEDDINGS` defaults to enabled when `OPENAI_API_KEY` is present. Set
`OPENAI_EMBEDDINGS=false` to use the local deterministic hash embedding fallback
instead of calling OpenAI.

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

On this machine, the Vite dev server currently hits the local file-descriptor limit, so the verified path is the built Nitro server above.

## Test

```bash
npm run check
npm run test
```

The VectorDB files are generated under `.data/` and are intentionally ignored.

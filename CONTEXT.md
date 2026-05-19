# Attestify

Attestify explores source-attested retrieval: a system that answers from a corpus by citing semantic assertions anchored in source documents, rather than citing arbitrary retrieval chunks.

## Language

**Source Document**:
A document or transcript treated as authoritative for what it expresses.
_Avoid_: truth source, canonical fact store

**Source Snapshot**:
A versioned capture of a source document at a specific point in time.
_Avoid_: current doc, latest text

**Source Span**:
A bounded region of source text with enough locator metadata to be retrieved and displayed.
_Avoid_: chunk when discussing citations

**Retrieval Chunk**:
A source span used for recall during search.
_Avoid_: citation, proof

**Attestation**:
A semantic assertion that a source span expresses, anchored by text inside that span.
_Avoid_: fact, truth, model thought

**Citation Unit**:
A citeable object joining an attestation to its source document, source span, citation handle, and support metadata.
_Avoid_: RAG chunk, quote blob

**Citation Handle**:
A stable identifier used by answers to refer to a citation unit.
_Avoid_: footnote ID when identity/versioning matters

**Source-Faithful**:
Supported by the source text, regardless of whether the statement is true in the world.
_Avoid_: true, verified fact

**Answer Synthesis**:
The model step that turns selected citation units into a user-facing answer.
_Avoid_: retrieval, extraction

**Reconciliation**:
The answer-layer treatment of conflicting source-faithful attestations.
_Avoid_: truth arbitration

## Relationships

- A **Source Document** has one or more **Source Snapshots** when the corpus changes over time.
- A **Source Snapshot** is segmented into one or more **Source Spans**.
- A **Source Span** can be used as a **Retrieval Chunk**.
- A **Source Span** can express zero or more **Attestations**.
- An **Attestation** belongs to exactly one **Source Span**.
- A **Citation Unit** cites exactly one **Attestation** and includes its **Source Span**.
- An answer should cite **Citation Units**, not **Retrieval Chunks**.
- **Reconciliation** happens after citation selection; it does not change the source-faithful record.

## Example dialogue

> **Dev:** "The retriever found the paragraph. Can the answer cite that chunk?"
> **Domain expert:** "No. The chunk is recall context. The answer cites a Citation Unit, because that tells us which attestation the source span expresses."
>
> **Dev:** "What if a Notion decision doc and a Granola transcript disagree?"
> **Domain expert:** "Both can produce source-faithful attestations. The answer can reconcile the discrepancy, but the citation layer should preserve both."
>
> **Dev:** "So verified means true?"
> **Domain expert:** "No. Verified means supported by the source text. The document is the authority for citation, not for world truth."

## Flagged ambiguities

- "Fact" was used early in the discussion, but it overloaded source expression with world truth. Resolved term: **Attestation**.
- "Citation" was used for raw retrieved text and for semantic source-backed units. Resolved term: **Citation Unit** for citeable output, **Retrieval Chunk** for recall context.
- "Knowledge graph" was considered as a framing, but the current system does not yet model durable entities, relations, or graph identity. Resolved framing: source-attested retrieval.
- "Verified" can imply truth. In this project it means **Source-Faithful**, not true in the world.

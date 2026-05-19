# Cite Source Attestations, Not Retrieval Chunks

Attestify will treat citations as source-faithful attestations anchored inside source spans, not as arbitrary chunks returned by vector search. Retrieval chunks remain useful for recall, but answerable citations must pass through a citation unit that records the attestation, source span, source document metadata, citation handle, and support check. This preserves the central boundary: the citation layer records what a source expresses, while answer synthesis handles explanation and reconciliation without turning source-faithfulness into a claim of world truth.

## Consequences

- The system needs extraction and verification layers in addition to retrieval.
- The answer route must keep citing citation handles, not raw chunk IDs.
- Fast-moving corpora need source snapshots or content hashes so old citations can resolve to the document version that produced them.
- Model-written claims cannot be promoted into the citation store unless they are anchored back to source text.

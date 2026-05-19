# PRD - Slice 03: Versioned Citation Identity

## Problem Statement

Current citation handles combine attestation and span IDs, which is enough for checked-in generated data but not enough for mutable private corpora. In a Notion workspace, transcript store, or changing manual, the same locator can point to different text over time. Without source versioning, a stored answer can appear cited while resolving to text that no longer supports the original attestation.

That is worse than an obvious failure because it silently degrades citation into "whatever this span means today."

## Solution

Citation identity includes connector identity, external source identity, source snapshot/version or content hash, span locator, attestation identity, and extraction version. Old answers resolve to the source snapshot that produced them, while current documents can still be reindexed and cited separately.

## User Stories

1. As a user, I want an old answer citation to resolve to the source version it used, so that the citation remains auditable after documents change.
2. As a user, I want the UI to show when a citation comes from an older source snapshot, so that I do not mistake it for the latest document state.
3. As a developer, I want citation handles to include enough identity to survive reindexing, so that answer history does not break when the index is rebuilt.
4. As a developer, I want source version or content hash to be required for mutable connectors, so that citation identity cannot quietly become current-state identity.
5. As a connector author, I want to map external document IDs into internal source identity, so that source systems remain traceable.
6. As a connector author, I want update timestamps to remain metadata, not identity by themselves, so that coarse clocks do not produce false stability.
7. As a reviewer, I want history detail to preserve the full citation identity, so that stored runs can be inspected without relying on the live index.
8. As an evaluator, I want test fixtures where a source changes after an answer, so that citation resolution proves snapshot behavior rather than current text behavior.
9. As a maintainer, I want legacy generated-corpus handles to keep working during migration, so that the prototype does not break while gaining real identity.
10. As a developer, I want extraction version in the identity or metadata, so that improved extractors do not overwrite the provenance of old attestations.
11. As a user, I want broken citation resolution to fail visibly, so that missing snapshots are not rendered as supported claims.
12. As a product owner, I want identity design to avoid calling citations "truth," so that source-faithfulness remains the contract.

## Implementation Decisions

- Promote source snapshots to first-class identity for citation resolution.
- Make citation handles resolvable through a structured identity rather than only string concatenation.
- Include connector, external source ID, source snapshot version or content hash, span locator, attestation ID, and extraction version in the identity model or resolvable metadata.
- Keep user-facing citation labels compact while storing full provenance behind them.
- Preserve current handles through a compatibility strategy until generated fixture data is migrated.
- Ensure history writes store enough citation detail to render prior answers even if the live corpus index changes.
- Treat update time as useful display metadata, not the only version authority.
- Make unresolved or stale citations visually and structurally distinct from source-faithful resolved citations.

## Testing Decisions

- Good tests for this slice prove old citations resolve against the source snapshot that produced them after the live source changes.
- Test that citation identity differs when the same external source has a new content hash or version.
- Test that missing snapshot material produces an explicit unresolved state rather than silently using current source text.
- Test that history detail preserves citation identity and display data.
- Keep tests focused on identity and resolution behavior; do not test vector retrieval quality here.
- Add a migration or compatibility test if legacy generated handles remain supported.

## Out of Scope

- Building full connector sync is out of scope; this slice assumes source snapshots can exist.
- Claim-level answer verification is out of scope; this slice preserves what was cited, not whether the answer claim was entailed.
- Conflict display is out of scope; versioned identity makes conflicts traceable but does not render them.
- Production storage selection is out of scope unless the current local store cannot represent the required identity.

## Further Notes

The sabotage case is subtle: a citation can still render text and look valid while pointing at the wrong version. This slice should make that impossible or visibly unresolved.


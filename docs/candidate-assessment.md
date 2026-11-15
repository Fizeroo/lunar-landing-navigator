# Candidate assessment interpretation

`src/science/candidate-assessment.ts` interprets existing `CandidateResult` values. It does not change ephemeris, DEM, search order, duration math, ranking or candidate IDs.

## Model and states

`assessCandidateResult(result, selectedModel = 'terrain')` defaults the finder to the local-terrain model. `insufficient` is represented as `unknown`; it never passes.

| State | Meaning |
| --- | --- |
| `confirmed-failure` | At least one required terrain ray is known blocked, or an explicitly selected reference-sphere condition fails. A known terrain blocker takes precedence even when the other body is unknown. |
| `terrain-unknown` | No required terrain ray is known blocked, but at least one is `insufficient`; distant terrain cannot be excluded. |
| `conditional-reference` | Reference geometry is up at the exact ephemeris coverage end, but no future joint duration is known. This is not called a physical failure. |
| `confirmed-within-model` | Both current terrain rays are certified clear, or an explicit reference-sphere assessment meets its current one-second joint criterion. The reason names the model and remains limited to that model. |

Reference-sphere duration is carried separately as `referenceSphere: pass | fail | data-limited`; it never changes terrain status. When a selected reference-sphere result is confirmed, a terrain blocker/unknown remains in the per-body diagnostics and in the short reason. There is no terrain mission duration.

Reasons are one short phrase for the compact row; the existing detail disclosure retains criteria and limitations. The assessment does not claim a safe or suitable landing site.

## Shortlist

`selectCandidateShortlist(results, limit = 3)` is presentation-only. It returns candidates with no known terrain blocker first, preserving reference-ranking order within that group, then fills unused slots with known-blocked results in their original order. Unknown terrain remains unknown and is not described as passing. Records and IDs are unchanged. Keep the full evaluated count from the original `results.length`; do not replace it with shortlist length. Candidate markers and panel rows should consume the same returned shortlist.

## Focused checks

```powershell
node --test scripts/ephemeris/candidate-assessment.test.mjs
```

Six synthetic checks cover terrain-default behavior, known-blocker precedence, insufficient-to-unknown mapping, explicit reference-model assessment retaining terrain warnings, coverage-end conditional interpretation, instantaneous-only terrain clear, stable within-group shortlist order, failure fill, ID preservation, and unchanged total count.

---
status: done
priority: p3
issue_id: 190
tags: [code-review, phase-0, regional-intelligence, performance, dry]
dependencies: []
---

# Hot-loop JSON.stringify(caseFile) duplicated across modules - precompute once

## Problem Statement
`actor-scoring.mjs:38`, `balance-vector.mjs:259` (`computeAllianceCohesion`), `scenario-builder.mjs:50` all call `JSON.stringify(f?.caseFile ?? ...).toLowerCase()` per forecast per region. For 14 forecasts x 8 regions x 5 callsites = 560 calls producing identical strings. Also creates inconsistency: actor-scoring checks `caseFile ?? signals`, alliance-cohesion checks only `caseFile`.

## Findings
- 5 call sites stringify `caseFile` per-forecast-per-region
- ~560 redundant stringifies per seed run at current scale
- Inconsistent fallback: some use `caseFile ?? signals`, others use `caseFile` only
- Text is identical across callsites for the same forecast - prime memoization target

## Proposed Solutions

### Option 1: Precompute caseFileText once in main()
Attach `_caseFileText` to each forecast before the region loop; all modules read it.

**Pros:** Single source of truth for what counts as searchable text; ~560 stringifies become 14; removes inconsistency
**Cons:** Adds a non-schema field to the forecast object (prefix with `_` to signal internal)
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Affected files:
- `scripts/regional-snapshot/actor-scoring.mjs:38`
- `scripts/regional-snapshot/balance-vector.mjs:259` (computeAllianceCohesion)
- `scripts/regional-snapshot/scenario-builder.mjs:50`
- `scripts/seed-regional-snapshots.mjs` - main() where precomputation would land

The current code pattern is roughly:
```js
JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase()
```

The fallback chain must be normalized across all callers.

## Acceptance Criteria
- [ ] Precompute `_caseFileText: string` per forecast once before the region loop in main()
- [ ] All modules read `f._caseFileText` instead of re-stringifying
- [ ] Single consistent definition of what fields contribute to the searchable text

## Work Log
- undefined: Partially fixed — within scripts/regional-snapshot/{actor-scoring,balance-vector,scenario-builder}.mjs, added a shared per-file `caseFileText(f)` helper that reads `f._caseFileText` when present and otherwise falls back to a single normalized `JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase()` (wrapped in try/catch), removing the `caseFile`-only vs `caseFile ?? signals` inconsistency between actor-scoring/scenario-builder and balance-vector's computeAllianceCohesion. Left status `pending`: the actual precompute-once step (`_caseFileText` attached per forecast before the region loop in `main()`) belongs in scripts/seed-regional-snapshots.mjs, which is outside this workstream's ownership (scripts/regional-snapshot/actor-scoring.mjs, balance-vector.mjs, evidence-collector.mjs, scenario-builder.mjs only). Modules are now ready to consume `_caseFileText` as soon as the orchestrator sets it, with no code change needed on this side.
- 2026-08-03: Closed the loop — added the precompute step in `scripts/seed-regional-snapshots.mjs`'s `main()`, right after `readAllInputs()` and before the `Promise.allSettled(REGIONS.map(...))` fan-out: iterates `sources['forecast:predictions:v2'].predictions` once and sets `f._caseFileText = JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase()` (try/catch, falls back to `'{}'') on each forecast object in place. Since `sources` is a single object shared by reference across every `processRegion()` call, all 8 regions' calls into `scoreActors`/`computeAllianceCohesion`/`buildScenarioSets` now see the field pre-populated and the modules' existing `caseFileText(f)` helpers short-circuit on `f._caseFileText` — collapsing the ~560 redundant per-region-per-module stringifies down to 1-per-forecast (14). All 3 acceptance criteria now met. Verified: `npx biome lint scripts/seed-regional-snapshots.mjs` clean; `tests/regional-snapshot*.test.mjs` + `tests/scripts-shared-mirror.test.mjs` (303/303) and `tests/get-regional-snapshot.test.mts` (30/30) all pass.

## Resources
- PR #2940
- PR #2942

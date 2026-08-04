---
status: pending
priority: p3
issue_id: 192
tags: [code-review, phase-0, regional-intelligence, performance, safety]
dependencies: []
---

# Performance micro-cleanups (buildPreMeta x8, signal indexing, evidence chokepoint filter, prototype-pollution guards)

## Problem Statement
Several minor perf and safety cleanups:

1. `buildPreMeta(sources)` is called 8x with identical results (only depends on sources, not regionId). Hoist out of `computeSnapshot` into `main()`.
2. `signals.filter(theater substring)` rebuilds per region in `balance-vector.mjs` and `evidence-collector.mjs`. Precompute `signalsByRegion` Map once in `main()`.
3. `evidence-collector.mjs:62-77` iterates ALL chokepoints regardless of region. Filter by `getRegionCorridors(regionId).map(c => c.chokepointId)`.
4. `geography.js:countryCriticality()` and `regionForCountry()` use bracket access on plain objects - prototype pollution risk if `iso2` is `__proto__`. Use `Object.hasOwn()` guard.
5. `JSON.stringify(snapshot)` happens twice in `persist-snapshot.mjs` (for tsKey and idKey). Stringify once, reuse.
6. `actor-scoring.mjs`, `balance-vector.mjs`, `scenario-builder.mjs` `JSON.stringify` on `caseFile` not wrapped in try/catch. Circular references in upstream payload would crash the seed for all 8 regions.

## Findings
- #1-3, #5 are pure perf: redundant work per region
- #4 is a safety issue (bracket access on user-supplied string keys)
- #6 is a reliability issue (one bad forecast crashes the whole seed)
- All items small, independent, safe

## Proposed Solutions

### Option 1: Do all 6 in one PR
Small mechanical cleanups; low risk.

**Pros:** Single follow-up
**Cons:** Mix of concerns
**Effort:** Small (each item)
**Risk:** Low

### Option 2: Split perf vs safety
(a) perf micros (#1, #2, #3, #5), (b) safety (#4, #6).

**Pros:** Each PR has a clean theme
**Cons:** More overhead
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Affected files:
- `scripts/seed-regional-snapshots.mjs` - main(), computeSnapshot, buildPreMeta call site
- `scripts/regional-snapshot/balance-vector.mjs` - signals.filter, caseFile stringify
- `scripts/regional-snapshot/evidence-collector.mjs:62-77` - chokepoint iteration
- `scripts/regional-snapshot/actor-scoring.mjs` - caseFile stringify
- `scripts/regional-snapshot/scenario-builder.mjs` - caseFile stringify
- `scripts/regional-snapshot/persist-snapshot.mjs` - double stringify
- `shared/geography.js` - countryCriticality, regionForCountry

For #4, pattern:
```js
if (!Object.hasOwn(table, iso2)) return fallback;
return table[iso2];
```

For #6, wrap each `JSON.stringify(f?.caseFile ?? ...)` in try/catch and fall back to `"{}"` (ties in naturally with issue #190's precompute-once).

## Acceptance Criteria
- [ ] buildPreMeta hoisted to main()
- [ ] signalsByRegion indexed once
- [ ] Chokepoint evidence filtered by region corridors
- [ ] Object.hasOwn guards on geography lookups
- [ ] JSON.stringify(snapshot) called once per region
- [ ] caseFile JSON.stringify wrapped in try/catch with fallback to {}

## Work Log
- undefined: Partially fixed, left `pending` — scoped to this workstream's owned files (actor-scoring.mjs, balance-vector.mjs, evidence-collector.mjs, scenario-builder.mjs) only. Item #6 (wrap `caseFile` JSON.stringify in try/catch with `{}` fallback) is done via the new `caseFileText()` helper in actor-scoring.mjs, balance-vector.mjs, and scenario-builder.mjs. Item #3 (evidence-collector chokepoint iteration scoped to region corridors) was already implemented in the current code (evidence-collector.mjs filters `cps` by `regionChokepointIds` built from `getRegionCorridors(regionId)`) — not reproducible against the present source, no change needed. Items #1 (buildPreMeta hoist), #2 (signalsByRegion precompute), #5 (double JSON.stringify(snapshot) — also appears already fixed in scripts/regional-snapshot/persist-snapshot.mjs, which stringifies once into `json` and reuses it for both tsKey and idKey), and #4 (Object.hasOwn guards in shared/geography.js) all require edits to scripts/seed-regional-snapshots.mjs, scripts/regional-snapshot/persist-snapshot.mjs, and shared/geography.js respectively — all outside this workstream's ownership list, so left untouched for the owning workstream(s) to close out.
- 2026-08-03: Closed out items #1, #4, #5 (confirmed already fixed); left #2 genuinely pending.
  - **#1 done:** `scripts/seed-regional-snapshots.mjs` `main()` now calls `buildPreMeta(sources, SCORING_VERSION, GEOGRAPHY_VERSION, metaSources)` once, before the `Promise.allSettled(REGIONS.map(...))` fan-out, and passes the result through `processRegion(region, sources, metaSources, preMeta)` → `computeSnapshot(regionId, sources, metaSources, preMeta)`, which now uses `preMeta ?? buildPreMeta(...)` instead of always recomputing. Collapses 8 identical `buildPreMeta` calls (same `sources`/`metaSources`, regionId-independent) into 1.
  - **#4 done:** `regionForCountry()` and `countryCriticality()` in both `shared/geography.js` and `scripts/shared/geography.js` (kept identical, per the `scripts-shared-mirror` test) now guard bracket access with `Object.hasOwn(table, iso2)` before indexing, closing the `iso2 === '__proto__'`/`'constructor'`/`'toString'` prototype-pollution-adjacent lookup risk (both tables are plain object/JSON-import literals, not `Object.create(null)`, so unguarded bracket access could previously return `Object.prototype` members like a function instead of `null`/the numeric default).
  - **#5 re-confirmed already fixed** (as the prior partial fix noted): `scripts/regional-snapshot/persist-snapshot.mjs:49` stringifies `snapshot` once into `json` and reuses it for both the `tsKey` and `idKey` `SET` commands.
  - **#2 left `pending`:** `signalsByRegion` precompute would require threading a precomputed per-region signal subset through `computeBalanceVector(regionId, sources)` (balance-vector.mjs) and `collectEvidence(regionId, sources)` (evidence-collector.mjs) — both currently self-contained functions that read+filter `sources['intelligence:cross-source-signals:v1']` internally via `isSignalInRegion`, which is not a strict 1:1 signal→region mapping (a signal can match multiple regions' theaters/aliases), so a correctness-preserving precompute requires changing both modules' function signatures and re-verifying against their existing test coverage. Given the p3 priority and that cross-source-signals arrays are small (order of tens to low hundreds of items), the perf win is marginal versus the interface-change risk; leaving this **pending for a dedicated follow-up** rather than rushing an under-verified signature change.
  - Verified: `npx biome lint scripts/seed-regional-snapshots.mjs shared/geography.js scripts/shared/geography.js` clean; `npx tsc --noEmit -p tsconfig.json` clean; `tests/regional-snapshot*.test.mjs` + `tests/scripts-shared-mirror.test.mjs` (333/333) and `tests/get-regional-snapshot.test.mts` all pass.

## Resources
- PR #2940
- PR #2942

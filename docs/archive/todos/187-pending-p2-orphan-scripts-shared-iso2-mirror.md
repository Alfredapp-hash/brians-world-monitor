---
status: done
priority: p2
issue_id: 187
tags: [code-review, phase-0, regional-intelligence, dead-code, convention]
dependencies: []
---

# scripts/shared/iso2-to-region.json is orphaned (no consumer in Phase 0)

## Problem Statement
PR #2940 mirrors `shared/iso2-to-region.json` to `scripts/shared/iso2-to-region.json` per the convention enforced by `tests/edge-functions.test.mjs`. But Phase 0 only imports from `shared/geography.js` which reads `./iso2-to-region.json` (the `shared/` original). The mirror has zero runtime consumers.

The convention exists for files imported by both Vite (src/) and Node ESM (scripts/) directly. Phase 0 doesn't import directly from scripts/.

## Findings
- `scripts/shared/iso2-to-region.json` has no runtime consumer in Phase 0
- The mirror convention targets files imported directly by scripts/ Node ESM paths
- Phase 0 geography lookups go through `shared/geography.js`
- `tests/edge-functions.test.mjs` enforces the mirror regardless of whether there's a consumer

## Proposed Solutions

### Option 1: Delete the mirror
Remove `scripts/shared/iso2-to-region.json` and update `tests/edge-functions.test.mjs` to skip `iso2-to-region` on the mirror check.

**Pros:** No dead JSON file; test doesn't mislead
**Cons:** Future scripts/-side consumers will need to re-add it
**Effort:** Small
**Risk:** Low

### Option 2: Document why the mirror must exist forward-compatibly
Leave the mirror, add a comment in the JSON file or a nearby README explaining the convention.

**Pros:** Keeps infra simple; future-proof
**Cons:** Looks unused to reviewers
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
Files:
- `shared/iso2-to-region.json` - canonical source
- `scripts/shared/iso2-to-region.json` - mirror (orphan in Phase 0)
- `shared/geography.js` - the only Phase 0 consumer (reads shared/)
- `tests/edge-functions.test.mjs` - enforces mirror

## Acceptance Criteria
- [ ] Either delete the mirror (and update tests/edge-functions.test.mjs to skip iso2-to-region)
- [ ] Or document why the mirror must exist forward-compatibly

## Work Log

- undefined: Already resolved / not reproducible — doc's premise doesn't hold against the current tree. `scripts/shared/geography.js` has its own relative import `import iso2ToRegionData from './iso2-to-region.json'`, which resolves to the mirror (`scripts/shared/iso2-to-region.json`) itself, not to `shared/iso2-to-region.json`. Since `scripts/seed-regional-snapshots.mjs` imports `REGIONS`/`GEOGRAPHY_VERSION` from `./shared/geography.js` (the scripts/shared copy), the mirror IS a real Phase 0 runtime consumer. Also confirmed `tests/edge-functions.test.mjs` has no `iso2-to-region` reference at all — the mirror is actually enforced by `tests/scripts-shared-mirror.test.mjs`, not that file (doc referenced the wrong test). No files deleted; grepped whole repo for `iso2-to-region` to confirm.

## Resources
- PR #2940
- PR #2942

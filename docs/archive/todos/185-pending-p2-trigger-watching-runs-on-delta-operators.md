---
status: done
priority: p2
issue_id: 185
tags: [code-review, phase-0, regional-intelligence, triggers]
dependencies: [171]
---

# trigger-evaluator runs isCloseToThreshold on delta operators that are unconditionally false

## Problem Statement
`scripts/regional-snapshot/trigger-evaluator.mjs:18-35`. `evaluateThreshold` returns false for two reasons: (a) threshold not breached, (b) operator is `delta_*` (Phase 0 stub). In case (b), `isCloseToThreshold` STILL runs and could elevate dormant triggers to "watching" based on misleading math.

## Findings
- `delta_*` operators are stubbed to return false in Phase 0
- `isCloseToThreshold` has no knowledge of the stub
- Watching-state elevation for delta-gated triggers is semantically wrong
- Downstream Phase 1 readers will surface these as near-triggers incorrectly

## Proposed Solutions

### Option 1: Skip isCloseToThreshold for delta_* operators
Guard at the top of the watching branch.

**Pros:** Minimal change; correct semantics
**Cons:** Adds one branch
**Effort:** Small
**Risk:** Low

## Recommended Action


## Technical Details
File: `scripts/regional-snapshot/trigger-evaluator.mjs:18-35`
Related issue: #171 (isCloseToThreshold inverted for lt operators)

## Acceptance Criteria
- [ ] Skip isCloseToThreshold for delta_* operators
- [ ] Test: delta_gt trigger never appears in watching list during Phase 0

## Work Log

- undefined: Already resolved / not reproducible — the same fix that addressed #171 (commit c82f827e, PR #3656) added explicit `delta_gt`/`delta_lt` cases to `isCloseToThreshold` that unconditionally return `false`, so delta-gated triggers can never be elevated to "watching" regardless of value; `evaluateTriggers`'s watching branch therefore already behaves as if guarded. Covered by `tests/regional-snapshot.test.mjs` (delta_lt/delta_gt cases). No further change needed.

## Resources
- PR #2940
- PR #2942
- Related: issue #171

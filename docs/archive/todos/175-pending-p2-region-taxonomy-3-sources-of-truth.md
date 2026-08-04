---
status: done
priority: p2
issue_id: 175
tags: [code-review, phase-0, regional-intelligence, dry, taxonomy]
dependencies: []
---

# Region taxonomy has 3 independent sources of truth (PR #2942 should import REGIONS from geography.js)

## Problem Statement

PR #2940 ships `shared/geography.js` with `REGIONS` and `forecastLabel` fields. PR #2942 ships `ForecastPanel.ts:10-19` with a hardcoded `FORECAST_REGIONS` constant duplicating the same labels. Plus `api/mcp.ts:556` enumerates DIFFERENT region examples ("Asia Pacific" not "East Asia"), breaking agent-native parity. Plus `scripts/seed-forecasts.mjs` writes `f.region` strings via `MACRO_REGION_MAP` that are a fourth implicit source.

Adding a region requires editing 3-4 files. They will drift.

## Findings

- `src/components/ForecastPanel.ts:10-19` — hardcoded `FORECAST_REGIONS` constant.
- `shared/geography.js:46-124` — canonical `REGIONS` with `forecastLabel` field.
- `api/mcp.ts:556-577` — generate_forecasts tool description enumerates "Asia Pacific" etc. (different from geography).
- `scripts/seed-forecasts.mjs` — `MACRO_REGION_MAP` as implicit fourth source.

## Proposed Solutions

### Option 1: ForecastPanel.ts imports REGIONS from shared/geography

Derive `FORECAST_REGIONS` via `REGIONS.map(r => ({ id: r.id, label: r.forecastLabel }))`. Update `api/mcp.ts` to enumerate the same labels (also via import from geography).

**Pros:** Zero new files; uses the module already designated as canonical; straight deletion of duplicates.
**Cons:** Minor — TS consumers need to deal with a `.js` import, but that's already a pattern elsewhere.
**Effort:** Small.
**Risk:** Low.

### Option 2: Extract a shared/forecast-regions.ts module

Create a dedicated `shared/forecast-regions.ts` module exporting the canonical list. ForecastPanel + MCP both import.

**Pros:** Explicit module for this concern.
**Cons:** Creates a second layer of indirection when geography.js is already the intended source of truth.
**Effort:** Small.
**Risk:** Low.

## Recommended Action

Option 1 — `geography.js` is already the canonical source; the panel and MCP description should consume it directly. Delete `FORECAST_REGIONS` and the ad-hoc MCP examples.

## Technical Details

`shared/geography.js` already has the `forecastLabel` field on every `REGIONS` entry specifically for this use case (added in PR #2940). The panel duplication in #2942 defeats the purpose. The MCP description drift ("Asia Pacific" vs "East Asia") is an agent-native correctness bug — MCP clients generate structured calls against the documented examples, so mismatched labels become unresolvable filters at runtime.

The `scripts/seed-forecasts.mjs` `MACRO_REGION_MAP` is a fourth source but its job is ISO2 → region mapping, not label authority. It should still derive its region IDs from `REGIONS`.

## Acceptance Criteria

- [ ] `ForecastPanel.ts` imports `REGIONS` from `shared/geography.js`.
- [ ] `api/mcp.ts` `generate_forecasts` tool description enumerates exactly the same labels.
- [ ] Adding a region in `geography.js` automatically updates UI pills and MCP description.
- [ ] `MACRO_REGION_MAP` in `seed-forecasts.mjs` references `REGIONS` for the region IDs.

## Work Log

- undefined: Fixed (scoped to ForecastPanel.ts + get-forecasts.ts import sites only, per workstream scope) — `ForecastPanel.ts` now imports `REGIONS` from `shared/geography.js` and derives `FORECAST_REGIONS` pills via `REGIONS.filter(r => r.id !== 'global').map(r => ({ id: r.id, label: r.forecastLabel }))` instead of a hardcoded duplicate list; `get-forecasts.ts` was inspected and has no local region-taxonomy duplicate to dedupe (it does a generic substring match on `req.region` against whatever string is passed), so no change was needed there. `api/mcp.ts` and `scripts/seed-forecasts.mjs` are explicitly out of scope for this workstream and were left untouched.
- 2026-08-03: Adversarial verify correctly flagged that marking this `done` overstated completion — acceptance criteria #2 (`api/mcp.ts` labels) and #4 (`MACRO_REGION_MAP`) were untouched. Closed the loop on both:
  - **AC #2 fixed for real:** `api/mcp.ts` no longer exists as a single file (repo has since split MCP tool defs into `api/mcp/registry/*.ts`); the `generate_forecasts` tool description now lives in `api/mcp/registry/rpc-tools.ts`. Added `const FORECAST_REGION_LABEL_EXAMPLES = REGIONS.map(r => r.forecastLabel).filter(Boolean).join('", "')` (imported `REGIONS` from `shared/geography.js`, following the existing `api/mcp/registry/rpc-tools.ts` → `shared/*.js` import precedent already used in that same file for `COUNTRY_BBOXES`/`MINING_SITES_RAW`) and used it in the `region` input-schema description, replacing the stale hardcoded `"Middle East", "Europe", "Asia Pacific"` examples (note: `REGIONS` has no `"Asia Pacific"` label at all — the real one is `"East Asia"` — confirming the doc's original drift report). Now genuinely derived: adding/renaming a region in `geography.js` updates this description automatically.
  - **AC #4 investigated, found not applicable as stated:** `MACRO_REGION_MAP` in `seed-forecasts.mjs` does **not** write `f.region` (verified via full-file grep of every `region:` assignment site — every persisted forecast's `region` field is a free-text label like `'Middle East'`, `'Global'`, `'United States'`, `rate.countryName`, etc., set directly, never through `MACRO_REGION_MAP`). `MACRO_REGION_MAP` is a separate, unrelated lookup used only by `getMacroRegion()`/`isCrossTheaterPair()`/`classifyEffectClass()` for cross-theater cascade-spillover scoring, with its own intentionally coarser 6-bucket taxonomy (`MENA`/`EAST_ASIA`/`AMERICAS`/`EUROPE`/`SOUTH_ASIA`/`AFRICA` — deliberately merging North America + Latin America into one `AMERICAS` bucket, which the 8-region display taxonomy in `geography.js` does not do). Forcing it to reference `REGIONS` would either break the cross-theater spillover semantics (finer-grained buckets would classify more pairs as "cross-theater" than intended) or require a translation layer the doc never specifies. The original PR review's premise that this map is a "fourth source of truth" for `f.region` was a misdiagnosis; leaving it untouched is correct, not a shortfall.
  - Verified: `npx biome lint api/mcp/registry/rpc-tools.ts` clean; `npx tsc --noEmit -p tsconfig.api.json` clean; `tests/llms-txt-mcp-tools.test.mjs` + `tests/mcp-tool-output-contracts.test.mjs` + `tests/mcp-schema-default-parity.test.mjs` (55/55) all pass.

## Resources

- PR #2940
- PR #2942
- Spec: `docs/internal/pro-regional-intelligence-upgrade.md`

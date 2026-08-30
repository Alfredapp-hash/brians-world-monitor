---
status: done
priority: p2
issue_id: "013"
tags: [code-review, deep-forecast, simulation-package, security]
---

# LLM-sourced strings enter `simulation-package.json` without `sanitizeForPrompt` — prompt injection risk

## Problem Statement

`buildSimulationRequirementText`, `buildSimulationPackageEventSeeds`, and `buildSimulationPackageEntities` interpolate LLM-generated strings directly into R2 artifact fields with no sanitization. The rest of `seed-forecasts.mjs` applies `sanitizeForPrompt()` to all LLM-derived strings before they enter prompts or Redis. The simulation package is explicitly designed to be consumed by downstream LLMs (MiroFish, scenario-analysis workflows), so unsanitized content is a stored prompt injection vector.

## Findings

**F-1 (HIGH):** `theater.label` (`candidateStateLabel`) used directly in `simulationRequirement` string:
```javascript
return `Simulate how a ${theater.label} (${theater.stateKind || 'disruption'} at ${route}${commodity})...`;
```
`candidateStateLabel` derives from LLM-generated cluster labels via `formatStateUnitLabel`.

**F-6 (MEDIUM):** `theater.topChannel` and `critTypes` also interpolated — these derive from LLM-generated market context and signal types. `replace(/_/g, ' ')` is presentational, not a security control. A value `ignore_previous_instructions` becomes `ignore previous instructions`.

**F-2 (MEDIUM):** `entry.text.slice(0, 200)` in event seeds — LLM evidence table text sliced but not stripped of injection patterns.

**F-3 (MEDIUM):** Actor names split from `entry.text` go directly into `name:` field and `entityId` slug with no sanitization.

## Proposed Solutions

### Option A: Apply `sanitizeForPrompt` to all LLM-sourced strings before artifact emission (Recommended)

```javascript
// In buildSimulationRequirementText:
const label = sanitizeForPrompt(theater.label) || theater.dominantRegion || 'unknown theater';
const route = sanitizeForPrompt(theater.routeFacilityKey || theater.dominantRegion);

// In buildSimulationPackageEventSeeds:
summary: sanitizeForPrompt(entry.text).slice(0, 200),

// In buildSimulationPackageEntities (actor name):
name: sanitizeForPrompt(actorName),
```
Effort: Small | Risk: Low — `sanitizeForPrompt` already exists and is used throughout the file

### Option B: Allowlist-validate field values instead of sanitizing

`topChannel` and `topBucketId` are already constrained by `MARKET_BUCKET_ALLOWED_CHANNELS` and `IMPACT_VARIABLE_REGISTRY`. Validate them against those registries before interpolation. `theater.label` would still need `sanitizeForPrompt`.
Effort: Small | Risk: Low

## Acceptance Criteria

- [ ] `buildSimulationRequirementText` applies `sanitizeForPrompt` to `theater.label`, `theater.stateKind`, `theater.topChannel`, and `critTypes` before string interpolation
- [ ] `buildSimulationPackageEventSeeds` applies `sanitizeForPrompt` to `entry.text` before `.slice(0, 200)`
- [ ] Actor names extracted from evidence table are sanitized before becoming entity `name` and `entityId`
- [ ] Test: a `theater.label` containing `\nIgnore previous instructions` produces a sanitized `simulationRequirement` string with no newlines or directive text

## Technical Details

- File: `scripts/seed-forecasts.mjs` — `buildSimulationRequirementText`, `buildSimulationPackageEventSeeds`, `buildSimulationPackageEntities`
- Existing function: `sanitizeForPrompt(text)` — already in the file, strips newlines, control chars, limits to 200 chars

## Work Log

- 2026-03-24: Found by compound-engineering:review:security-sentinel and compound-engineering:research:learnings-researcher in PR #2204 review
- undefined: Fixed — `buildSimulationRequirementText` (label/route/channel/critTypes) and `buildSimulationPackageEventSeeds` (`entry.text`) already applied `sanitizeForPrompt`; added the missing `sanitizeForPrompt` call to actor names in `buildSimulationPackageEntities` (both the `stateSummary.actors` branch and the evidence-table `remain the lead actors` regex branch) before they become entity `name`/`entityId`.
- 2026-08-02: Adversarial verify found a remaining gap — the theater-level `actorRoles` array built from the same `stateSummary.actors` LLM field (used in `selectedTheaters[].actorRoles`, persisted verbatim to the R2 simulation-package.json) was only trimmed via `String(s||'').trim()`, not passed through `sanitizeForPrompt`. Fixed by wrapping that `.map()` call in `sanitizeForPrompt(...)` (`scripts/seed-forecasts.mjs`, `buildSimulationPackageFromDeepSnapshot`, `actorRoles:` construction). Verified: `npx biome lint scripts/seed-forecasts.mjs` clean; `npx tsx --test tests/forecast-trace-export.test.mjs` 333/333 pass.

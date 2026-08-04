---
status: done
priority: p3
issue_id: "074"
tags: [code-review, quality, analytical-frameworks]
dependencies: []
---

# `MAX_LEN = 2000` duplicated in `fetch-agentskills.ts` vs `MAX_INSTRUCTIONS_LEN` in `analysis-framework-store.ts`

## Problem Statement
`api/skills/fetch-agentskills.ts` defines its own `MAX_LEN = 2000` for instructions length. `src/services/analysis-framework-store.ts` already exports `MAX_INSTRUCTIONS_LEN` (or equivalent) for the same product limit. These constants are currently equal but defined independently — a change to one will silently diverge from the other.

## Proposed Solution
Import the shared constant in `fetch-agentskills.ts`. Note: edge functions (`api/*.ts`) cannot import from `src/` directly — if `MAX_INSTRUCTIONS_LEN` is in `src/`, extract it to a shared constants file accessible by both.

## Technical Details
- Files: `api/skills/fetch-agentskills.ts`, `src/services/analysis-framework-store.ts`
- Effort: Small | Risk: Low

## Work Log
- 2026-03-28: Identified by architecture-strategist during PR #2386 review
- undefined: Attempted fix imported `MAX_INSTRUCTIONS_LEN as MAX_LEN` directly from `src/services/analysis-framework-store.ts`, but that transitively pulls in `panel-gating.ts` → `auth-state.ts` → `clerk.ts`/`sentry-init.ts`/`analytics.ts`, which broke `npm run typecheck:api` (6 new TS errors: `__APP_VERSION__`, `__CLERK_JS_VERSION__`, `window.umami` not declared under `tsconfig.api.json`). No such `api/*.ts` → `src/` import precedent actually exists in the repo (fetch-agentskills.ts was the only offender).
- 2026-08-03: Fixed for real per the doc's own fallback plan — extracted `MAX_INSTRUCTIONS_LEN` into a new dependency-free `shared/framework-constants.ts` (mirroring the existing `api/*.ts` → `shared/*.ts` import precedent used by `api/internal/brief-why-matters.ts` → `shared/brief-llm-core.js`). Both `src/services/analysis-framework-store.ts` (imports and re-exports it for backward compatibility) and `api/skills/fetch-agentskills.ts` now import the constant from `shared/framework-constants.ts`. Verified: `npx tsc --noEmit -p tsconfig.api.json` and `-p tsconfig.json` both clean (0 errors); `npx biome lint` clean on all 3 touched files.

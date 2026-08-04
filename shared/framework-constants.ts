// Shared constants for analysis-framework instructions/description length limits.
// Kept dependency-free so both browser code (src/services/analysis-framework-store.ts)
// and edge functions (api/skills/fetch-agentskills.ts) can import it without pulling in
// browser-only globals (e.g. src/bootstrap/sentry-init.ts, analytics.ts, clerk.ts) that
// break `npm run typecheck:api`.
export const MAX_INSTRUCTIONS_LEN = 2000;

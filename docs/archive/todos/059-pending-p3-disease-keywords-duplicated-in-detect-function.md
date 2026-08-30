---
status: done
priority: p3
issue_id: "059"
tags: [code-review, quality, seeding, disease-outbreaks, duplication, pr-2375]
dependencies: []
---

## Problem Statement

`scripts/seed-disease-outbreaks.mjs` maintains two parallel lists that overlap significantly: a `diseaseKeywords` array (or constant) and the keyword list embedded inside the `detectDisease()` function. Any update to supported disease keywords must be made in both places, or the two lists drift out of sync.

## Findings

- **File:** `scripts/seed-disease-outbreaks.mjs` — `diseaseKeywords` constant and `detectDisease()` function both enumerate disease names/keywords
- **Overlap:** The function's keyword list appears to be a superset or duplicate of `diseaseKeywords`
- **Impact:** Adding a new disease (e.g., MPOX variant) requires two edits; omitting one causes inconsistent behavior between any code that uses `diseaseKeywords` directly vs calls `detectDisease()`

## Proposed Solutions

**Option A: Remove standalone array, have detectDisease() be the single source (Recommended)**

If `diseaseKeywords` is only used to drive `detectDisease()`, inline the array into the function and export only the function.

- **Effort:** Small (consolidate + verify no other consumers of the array)
- **Risk:** Very low

**Option B: Make detectDisease() use the diseaseKeywords array**

```javascript
const DISEASE_KEYWORDS = ['mpox', 'ebola', 'cholera', ...];
function detectDisease(text) {
  return DISEASE_KEYWORDS.find(k => text.toLowerCase().includes(k)) || null;
}
```

- **Effort:** Trivial
- **Risk:** Very low — clean single source of truth

## Acceptance Criteria

- [ ] Disease keyword list exists in exactly one place
- [ ] `detectDisease()` uses that single list

## Work Log

- 2026-03-27: Identified by simplicity-reviewer agent during PR #2375 review.
- undefined: Fixed — the code has since diverged from the doc's premise (`detectDisease()` now lives in `scripts/_disease-outbreaks-helpers.mjs`, not this file, and the local `diseaseKeywords` array in `seed-disease-outbreaks.mjs` is a broad relevance *filter* for RSS items, not an input to `detectDisease()`). Rather than a literal merge, removed every specific disease-name literal that duplicated `detectDisease()`'s list from the local array (now `GENERIC_OUTBREAK_TERMS`, holding only non-disease-specific terms like "outbreak"/"epidemic"/"fever"), and the relevance filter now also calls the already-imported `detectDisease()` so specific disease names are matched from that single source instead of being re-listed locally.

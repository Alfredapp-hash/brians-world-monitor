# OSINT4ALL catalog (portable v2)

Source of truth for The Public Dispatch OSINT section.

- Meta (categories, hints, synonyms): `catalog.meta.json` — 49 categories, `tools: []`
- Tool shards: `catalog.tools.a.json` + `catalog.tools.b.json` — merged in memory to 246 tools
- Loader: `src/osint/load-catalog.ts` fetches the three same-origin files and merges them
- Test fixture only: `src/osint/catalog.fixture.json` (3 tools). Do not treat it as the production catalog.
- Types: `src/osint/catalog.types.ts`
- Do **not** add `public/osint/_parts/` or `catalog.json.partN` files

Generated 2026-09-13 from OSINT4ALL `ToolDatabase.swift` / `SearchIndex.swift`.

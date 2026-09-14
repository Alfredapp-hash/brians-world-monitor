# OSINT4ALL catalog (portable v2)

Source of truth for The Public Dispatch OSINT section.

- Meta: `catalog.meta.json` — categories, tags, searchHints, synonyms; `tools` is empty; `toolShardFiles` is `catalog.tools.a.json`, `catalog.tools.b.json`
- Tool shards: `catalog.tools.a.json` and `catalog.tools.b.json` — each a **JSON array** of tools
- Loader: `src/osint/load-catalog.ts` fetches the three same-origin files and merges `{...meta, tools: [...a, ...b]}`. Expected: 246 tools / 49 categories
- This path is preferred over a single `catalog.json`
- Test fixture only: `src/osint/catalog.fixture.json` (3 tools). Do not treat it as the production catalog.
- Types: `src/osint/catalog.types.ts`
- Do **not** add `public/osint/_parts/` or `catalog.json.partN` files

Generated 2026-09-13 from OSINT4ALL `ToolDatabase.swift` / `SearchIndex.swift`.

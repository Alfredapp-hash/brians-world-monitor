# OSINT4ALL catalog (portable v2)

Source of truth for The Public Dispatch OSINT section.

- Meta: `catalog.meta.json` — categories, tags, searchHints, synonyms; `tools` is empty; `toolShardFiles` lists shard basenames
- Tool shards: `catalog.tools.0.json` … `catalog.tools.11.json` — each file is a **JSON array** of tools
- Loader: `src/osint/load-catalog.ts` fetches `/osint/catalog.meta.json`, then every file in `meta.toolShardFiles`, and concatenates the arrays. Expected merge: 246 tools / 49 categories
- Optional expand overlays: `catalog.details-0.json`, `catalog.details-1.json`, `catalog.details-2.json`
- Test fixture only: `src/osint/catalog.fixture.json` (3 tools). Do not treat it as the production catalog.
- Types: `src/osint/catalog.types.ts`
- Do **not** add `public/osint/_parts/` or `catalog.json.partN` files
- Do **not** commit `file://` stub shards (`catalog.tools.a.json` / `catalog.tools.b.json`)

Generated 2026-09-13 from OSINT4ALL `ToolDatabase.swift` / `SearchIndex.swift`.

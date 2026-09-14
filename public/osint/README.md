# OSINT4ALL catalog (portable v2)

Source of truth for The Public Dispatch OSINT section.

- Meta: `catalog.meta.json` — categories, tags, searchHints, synonyms; `tools` is empty; `toolShardFiles` lists shard basenames
- Tool shards on tip: `catalog.tools.0.json` … `catalog.tools.11.json` — each a **JSON array** of tools
- Loader: `src/osint/load-catalog.ts` fetches `/osint/catalog.meta.json`, then every file in `meta.toolShardFiles`, and merges `{...meta, tools: concat(shards)}`. Expected: 246 tools / 49 categories
- Assembled portable file: `catalog.json` — same 246 tools / 49 categories / version 2, concatenated from `catalog.tools.0.json` … `catalog.tools.11.json` (no invented tools)
- Test fixture only: `src/osint/catalog.fixture.json` (3 tools). Do not treat it as the production catalog.
- Types: `src/osint/catalog.types.ts`
- Do **not** add `public/osint/_parts/` or `catalog.json.partN` files

Generated 2026-09-13 from OSINT4ALL `ToolDatabase.swift` / `SearchIndex.swift`.

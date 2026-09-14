# OSINT4ALL catalog (portable v2)

Source of truth for The Public Dispatch OSINT section.

- Full catalog: `catalog.json` — `OsintCatalog` v2 with 246 tools / 49 categories
- Loader: `src/osint/load-catalog.ts` fetches `/osint/catalog.json` same-origin
- **`catalog.json` is pending.** The file is 210,649 bytes (over the ~100KB single MCP push limit). Waiting on a PM-approved path to land the real file. Do not invent tools.
- Test fixture only: `src/osint/catalog.fixture.json` (3 tools). Do not treat it as the production catalog.
- Types: `src/osint/catalog.types.ts`
- Do **not** add `public/osint/_parts/` or `catalog.json.partN` files

Generated 2026-09-13 from OSINT4ALL `ToolDatabase.swift` / `SearchIndex.swift`.

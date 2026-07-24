# Changelog

All notable changes to JSA's Monitor are documented here.

JSA's Monitor began as a fork of worldmonitor by koala73 (AGPL-3.0) and has
since diverged as an independent project. Pre-fork history lives in the
upstream repository; this changelog starts fresh at 1.0.0.

## [1.0.0] - 2026-07-24

### Added

- **Hard fork identity** — JSA's Monitor declares independence from upstream
  worldmonitor (AGPL-3.0). The package is renamed to `jsas-monitor`,
  versioning restarts at 1.0.0, and the upstream blog subproject is removed
  from the repository and build chain.
- **Full rebrand** — app shell, metadata, share cards, about and methodology
  pages, and community links now identify as JSA's Monitor
  (X: @JSAsmonitor, Discord: discord.gg/BCHZDq8Xt).
- **Coverage Compare + NCI engine** — side-by-side outlet coverage
  comparison with talking-point detection and NCI "Engineered Reality"
  scoring, backed by a public methodology page generated from the real
  scoring rubric.
- **Terrain map and grouped layers** — terrain basemap rendering and grouped
  map-layer controls land with this sprint's visual overhaul.
- **Seeded data pipeline** — scheduled GitHub Actions seeders publish
  datasets to Upstash Redis, keeping the dashboard live on independent
  infrastructure.
- **Local AI analysis** — optional Ollama integration for on-device
  summarization and analysis with no cloud dependency.

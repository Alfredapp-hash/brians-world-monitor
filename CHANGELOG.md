# Changelog

All notable changes to JSA's Monitor are documented here.

JSA's Monitor began as a fork of worldmonitor by koala73 (AGPL-3.0) and has
since diverged as an independent project. Pre-fork product/feature history
lives in the upstream repository; this changelog starts fresh at 1.0.0.
The Composite Instability Index (CII) formula version history below is
carried forward from upstream and kept up to date here because clients
depend on the `methodology_version` field and the `risk:scores:sebuf:vN`
cache key family to interpret and invalidate scores.

## CII Methodology Version History

- **CII formula `v8`**: fixed dead UCDP conflict-floor attribution. The server scorer read non-existent `intensity_level` / `type_of_violence` fields from the cached `conflict:ucdp-events:v1` feed (whose rows actually carry `violenceType`, `deathsBest`, and `dateStart`), so UCDP never applied its war (floor 70) / minor (floor 50) score floor and never counted toward the `riskScores` realtime health/cache signal coverage. UCDP is now classified per country over a 2-year trailing window (war when total deaths > 1000 or event count > 100; minor when event count > 10), matching the frontend `deriveUcdpClassifications` heuristic. The classifier is configured for that 2-year window, but Redis writers currently fetch the newest six UCDP pages and retain at most 2,000 mapped events from a 365-day trailing event slice; the relay `/ucdp-events` reader can fetch up to 12 pages but applies the same 365-day filter. Live scoring is seed-input-bounded until UCDP retention is widened with production API-volume and Redis-payload safeguards. The health coverage metric's conflict family is now satisfied by EITHER the ACLED API path OR UCDP, so a thin/empty ACLED window no longer flips health to `COVERAGE_PARTIAL` while UCDP is healthy. `combinedScore` values rise for active UCDP conflict countries (e.g. UA/PK/MX gain a war floor); the risk-score cache key family moved to `risk:scores:sebuf:v8` and emitted `methodology_version` is now `v8`; clients should re-baseline.
- **CII formula `v7`**: score attribution now changes for the second gap-closure batch. Coordinate attribution resolves three-way bbox overlaps before pairwise border rules, so Punggye-ri maps to KP instead of CN and Lublin maps to PL instead of UA; the seed mirror uses the same resolver. Targeted probes also cover Lhasa, Gaziantep, Kermanshah, Quetta/Islamabad, Dammam, Tabuk, Ruili, Belogorsk, north Hokkaido, and Amman. Climate anomaly boosts now cover the producer-emitted `Europe`, `East Asia`, and `Latin America` zones, restoring KP/KR/JP/PL/DE/FR/GB/VE coverage, and future unknown zones can fall back through anomaly coordinates when available. `combinedScore` values may shift for affected records, the risk-score cache key family moved to `risk:scores:sebuf:v7`, and emitted `methodology_version` is now `v7`; clients should re-baseline. Remaining coordinate attribution is still a rectangular approximation, not full point-in-polygon border geometry.
- **CII formula `v6`**: score attribution now changes as one batch for country text, coordinate, and climate anomaly inputs. The seed and server country resolvers now agree on token/phrase matching, Rio Grande US/MX border segments, the western Korean DMZ, RU/UA, IN/PK, CN/RU, and RU/JP bbox overlaps; `north korean` maps to KP and `taiwanese` maps to TW while bare `korean` remains ambiguous. Climate anomalies now feed the emitted producer zones (`Ukraine`, `California`, `Amazon`, `Taiwan Strait`, `Caribbean`, etc.) into CII and translate enum severities into the numeric climate boost scale. `combinedScore` values may shift for affected records, the risk-score cache key family moved to `risk:scores:sebuf:v6`, and emitted `methodology_version` is now `v6`; clients should re-baseline.
- **CII formula `v5`**: `dynamicScore` is now a signed movement delta in the range `-100..100`, derived from a valid CII snapshot from approximately 24 hours earlier. Positive values mean rising risk, negative values mean falling risk, and `0` means stable or no valid prior snapshot. The browser fallback trend deadband now matches the server rule (`> 1` / `< -1`, an effective two-point threshold for whole-point scores). `combinedScore` coefficients are unchanged, the risk-score cache key family moved to `risk:scores:sebuf:v5`, and emitted `methodology_version` is now `v5`; clients that previously treated `dynamicScore` as a non-negative live score should re-baseline.
- **CII methodology v4**: Country attribution and source inputs were tightened for the Composite Instability Index. Text attribution now uses token exact-match / phrase matching, known bounding-box overlaps route through explicit heuristics, the earthquake seed uses the USGS 4.5-week (`4.5_week`) feed, and sanctions scoring reads the full country-count map. Client impact: `combinedScore` values may shift for affected countries, the risk-score cache key family moved to `risk:scores:sebuf:v4`, and emitted `methodology_version` is now `v4`.
- **CII formula `v3`**: conflict event activity now uses log-scaled calibration before the final component cap, preserving distance between moderate and extreme event volumes. The browser CII path now matches the server displacement log-ramp instead of the old `+4/+8` tiers, and browser news-alert pressure is no longer amplified by per-country `eventMultiplier`. Public `combinedScore` values may shift and `methodology_version` is bumped `v2` -> `v3`; clients pinned on it should re-baseline. See `docs/methodology/cii-risk-scores.mdx`.
- **CII weights source of truth**: `baselineRisk` and `eventMultiplier` now come from one shared coefficient table used by both server-side risk scoring and frontend client-side CII rendering. The previous 7-country frontend/server drift was resolved to the published server/API values. Server/API values were unchanged by this refactor; the v3 `methodology_version` bump above is from the calibration changes, not this source-of-truth move.
- **CII formula `v2`**: the Composite Instability Index `Security` component now scores military flights, military vessels and aviation disruptions in addition to GPS jamming. The composite blend gains `newsUrgencyBoost`, `earthquakeBoost`, `sanctionsBoost` and an AIS-disruption boost; `cyberBoost`/`fireBoost` are now severity-weighted. Public `combinedScore` values shift accordingly and `methodology_version` is bumped `v1` -> `v2`; clients pinned on it should re-baseline.

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

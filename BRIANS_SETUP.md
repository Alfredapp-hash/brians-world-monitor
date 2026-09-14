# JSA's Monitor — Setup Notes

Customized fork of [worldmonitor](https://github.com/koala73/worldmonitor) (AGPL-3.0).

## What's different from upstream

- **Rebranded** as JSA's Monitor (title, meta, header/footer, PWA).
- **Science Discoveries panel** — 11 sources (ScienceDaily, Nature, Science/AAAS, Phys.org, New Scientist, Live Science, Scientific American, NASA, Space.com, Quanta, plus a discovery sweep).
- **Archaeology panel** — 8 sources (Archaeology Magazine, HeritageDaily, Ancient Origins, Sci.News, Smithsonian, The Past, Phys.org Archaeology, plus a news sweep).
- **Coverage Compare panel** (`src/components/CoverageComparePanel.ts`) — the spin filter:
  - Clusters the same story across outlets; groups coverage into mainstream / independent / state-affiliated / local press.
  - **Talking-point detection** (`src/utils/talking-points.ts`): shared-phrase analysis across distinct outlets; distinguishes wire syndication (normal) from coordinated messaging (flagged); loaded-language detection; narrative sync score.
  - **NCI Engineered Reality Score** (`src/utils/nci-score.ts`): 20-indicator rubric, 1–5 each, normalized 0–100 with tier bands (0–20 low → 81–100 extreme). ~13 indicators auto-score from live headline data; the full rubric (beneficiaries, missing info, cherry-picked stats, fallacies, historical parallels) is scored by your local AI on demand. The scale measures indicators, not proof.
- **`OLLAMA_EXTRA_HOSTS`** env (server): comma-separated extra hostnames allowed for server-side Ollama (e.g. a tunnel to your home PC).

## Local AI (Ollama) setup — your PC

1. Install [Ollama](https://ollama.com/download) and pull a model, e.g.:
   `ollama pull llama3.1:8b` (or a bigger model — your hardware can take it).
2. **Allow browser access** (required for the deployed site to reach your local Ollama):
   - Windows: System Properties → Environment Variables → add `OLLAMA_ORIGINS` = `*`
     (or the exact site origin, e.g. `https://your-app.vercel.app`), then restart Ollama.
   - Linux/macOS: `OLLAMA_ORIGINS='*' ollama serve`
3. In the app: Settings → **Ollama local summarization** → set
   `OLLAMA_API_URL` = `http://localhost:11434` and pick your model.
4. The AI Compare and Full NCI Score buttons in Coverage Compare now run
   entirely on your PC. No cloud keys needed.

## Running locally

```bash
npm install --ignore-scripts   # sharp may fail to fetch binaries in some sandboxes; it's only needed for blog OG images
npm run dev                    # http://localhost:3000
```

## Deploying to Vercel

Import this repo at vercel.com/new — framework auto-detects (Vite). No env
vars are required for core functionality. Optional free keys unlock extra
feeds (see `.env.example`): GROQ_API_KEY (AI fallback), FINNHUB (markets),
NASA FIRMS (fires), etc.

## Tests

```bash
npx tsx --test tests/talking-points.test.mts tests/nci-score.test.mts
```

## Lighting up every section (audit 2026-07-23)

Browser-audited every panel. Three groups:

**Live now (25 sections, no setup):** all news sections (World, US, Europe,
Middle East, Africa, LatAm, Asia, Energy, Gov, Think Tanks, Science,
Archaeology, Finance, Tech, AI, Layoffs), Coverage Compare, AI Insights,
Threat Timeline, Country Instability, Strategic Risk, Intel Feed,
Infrastructure Cascade, Displacement, Airline Intel.

**Live once deployed on Vercel (no keys):** Markets, Crypto, Stablecoins,
Earthquakes/Natural events, Predictions (Polymarket), World Clock, Weather,
Sanctions, National Debt, Disease Outbreaks — these call the repo's own
serverless functions, which exist only in production (the dev server has no
function runtime).

**Live with free API keys (add in Vercel → Project → Settings → Environment
Variables):**

- `FINNHUB_API_KEY` (finnhub.io) → richer Markets/Heatmap/Breadth
- `FRED_API_KEY` (fred.stlouisfed.org) → Macro Stress, Yield Curve
- `EIA_API_KEY` (eia.gov/opendata) → Oil Inventories, Energy Complex
- `NASA_FIRMS_API_KEY` (firms.modaps.eosdis.nasa.gov) → Fires, Thermal Escalation
- `AISSTREAM_API_KEY` (aisstream.io) → Ship tracking, Hormuz Tracker
- `GROQ_API_KEY` (console.groq.com) → cloud AI fallback when Ollama is off
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (upstash.com, free
  tier) → cross-visitor caching + unlocks the seeded panels (Radiation
  Watch, Pipeline Status, Storage Atlas, Fuel Shortages, Energy Disruptions,
  Security Advisories) after running `./scripts/run-seeders.sh`

Windows: `npx playwright install chromium` once, then:

```
SMOKE_URL=https://brians-world-monitor.vercel.app/dashboard node scripts/operator-no-llm-smoke.mjs
```

`scripts/panel-audit.mjs` walks every rendered panel against any URL
(`SMOKE_URL=https://your-app.vercel.app node scripts/panel-audit.mjs`).

## Operator live display (2026-08-27)

This fork is a personal dashboard, not the upstream SaaS free tier.

- `OPERATOR_UNLIMITED_PANELS` lifts the 40-panel ceiling so default-on
  live panels (fires, UCDP, climate, radiation, energy logs, etc.) are
  not auto-disabled. Custom widgets (`cw-*`) stay pro-only.
- Full-variant map defaults now paint already-hydrated feeds: protests,
  GPS jamming, UCDP, climate, displacement, fires, CII choropleth,
  disease outbreaks, radiation, cables, pipelines, storage, fuel
  shortages, AIS, flights, trade routes, minerals, webcams, cyber
  threats, satellites, day/night, datacenters, spaceports, and
  irradiators. Mobile stays lighter (protests, fires, flights, day/night).
- Full variant also shows Internet Disruptions, Service Status,
  Chokepoint Status, Climate News, Energy Risk Overview, Gulf Economies,
  Consumer Prices, grocery/Big Mac/fuel/FAO indexes, calendars, AAII,
  FSI, yield curve, COT, giving, geo hubs, Windy cams, and tech hubs.
- Regional Intelligence, Global Procurement, Trade Policy, and WSB
  Ticker Scanner are default-on Redis reads (no LLM spend). Resilience
  choropleth is unlocked as a toggle (conflicts with CII, so stays
  default-off). LLM surfaces stay gated: stock analysis/backtest,
  daily market brief, market implications, deduction, chat-analyst,
  latest-brief, classify-event, scenario run, MCP proxy.
- Returning browsers pick this up once via `jsam-live-display-v4`.
  After deploy, hard-refresh. If an old layout is still stuck, clear
  site data for the app origin.
- `/api/wm-session` fail-opens if Upstash rate-limit Redis is exhausted so
  a free-tier 500k-command cap cannot 503 the whole dashboard.
- Dashboard **loads Redis data once per page load**. Refresh the browser
  (F5) to update Redis-backed panels. Redis-backed API rate limits are
  skipped on this fork (one operator). Seeders run twice a day (06:00 and
  18:00 UTC). Together that is what keeps command count near Free.
- **Telegram Intel ticks every 60s** while the tab is visible (Railway
  relay, not Redis). OSINT, Middle East, cyber, conflict, breaking, and
  geopolitics are client-side tabs on that same feed (up to 200 posts).
  Fresh breaking/conflict/Middle East posts (last 15 min) also raise the
  breaking-news banner. The default `full` poll set includes the 8
  tech/cyber channels.
- **Israel Sirens** polls Railway every 60s on its own loop (not Redis).
- Polymarket stays F5-only: `listPredictionMarkets` reads Redis bootstrap.
  Do not add AIS, predictions, or other Redis surfaces to
  `OPERATOR_LIVE_TICK_PANELS`.

## Seeded panels — Upstash Redis + scheduled seeders (full activation)

Many panels render from a Redis cache that a background job fills. Two pieces:

**1. Upstash Redis (free) — the cache.**

- Sign up at https://upstash.com → Create Database → Redis → pick a region →
  copy the **REST URL** and **REST TOKEN** (the "REST API" section, not the
  redis:// URL).
- Add BOTH to two places, same values:
  - **Vercel** → project → Settings → Environment Variables:
    `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (so the app reads cache)
  - **GitHub** → repo → Settings → Secrets and variables → Actions → New
    repository secret: same two names (so the seeder job writes cache)

**2. Scheduled seeders — `.github/workflows/seed-data.yml`.**
Runs every 30 min on GitHub Actions (free for this public repo), sweeps all
`scripts/seed-*.mjs`, writes to your Upstash Redis. Trigger the first run
manually: repo → Actions → "Seed Data" → Run workflow. Seeders whose API key
is missing skip silently, so it works with just Redis and lights up more
panels as you add keys.

**Data-source keys** (add as GitHub Actions secrets for seeders; the two
request-time ones — Finnhub, Groq — also go in Vercel env vars):

| Secret | Free signup | Lights up |
| --- | --- | --- |
| `FINNHUB_API_KEY` | finnhub.io | Markets depth, Sector Heatmap, Breadth (also add to Vercel) |
| `GROQ_API_KEY` | console.groq.com | Cloud AI fallback for summaries/NCI (also add to Vercel) |
| `NASA_FIRMS_API_KEY` | firms.modaps.eosdis.nasa.gov | Fires, Thermal Escalation |
| `FRED_API_KEY` | fred.stlouisfed.org/docs/api/api_key.html | Economic calendar, macro series |
| `EIA_API_KEY` | eia.gov/opendata | Oil Inventories, Energy Complex, electricity prices |
| `AISSTREAM_API_KEY` | aisstream.io | Ship tracking, Hormuz Tracker |
| `ACLED_ACCESS_TOKEN` | acleddata.com (researcher signup) | Armed Conflict Events |
| `AVIATIONSTACK_API` | aviationstack.com | Flight schedules |

After adding Vercel env vars, redeploy (Vercel → Deployments → ⋯ → Redeploy)
so functions pick them up. After adding GitHub secrets, re-run the Seed Data
workflow. Then `SMOKE_URL=https://brians-world-monitor.vercel.app node
scripts/panel-audit.mjs` re-checks which panels went live.

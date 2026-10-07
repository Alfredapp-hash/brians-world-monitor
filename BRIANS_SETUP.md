# The Public Dispatch — Setup Notes

Production name: **The Public Dispatch**. Served from Netlify at <https://thepublicdispatch.com>. Owner: Brian.

Repository: [Alfredapp-hash/brians-world-monitor](https://github.com/Alfredapp-hash/brians-world-monitor), a customized fork of [worldmonitor](https://github.com/koala73/worldmonitor) (AGPL-3.0).

`index.html` and `netlify.toml` use The Public Dispatch. Older copy still says "JSA's Monitor" in `README.md`, `CHANGELOG.md`, and some server modules. New docs follow the production name. `README.md` still lists `https://brians-world-monitor.vercel.app` as live; that host is **retired** (402 `DEPLOYMENT_DISABLED`). Do not smoke-test it.

Deploy rules for agents: [AGENTS.md](AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Start at `netlify.toml` and `netlify/functions/`.

## What's different from upstream

- **Product name** on the shipped page is The Public Dispatch (title, meta, header).
- **Science Discoveries panel** — 11 sources (ScienceDaily, Nature, Science/AAAS, Phys.org, New Scientist, Live Science, Scientific American, NASA, Space.com, Quanta, plus a discovery sweep).
- **Archaeology panel** — 8 sources (Archaeology Magazine, HeritageDaily, Ancient Origins, Sci.News, Smithsonian, The Past, Phys.org Archaeology, plus a news sweep).
- **Coverage Compare panel** (`src/components/CoverageComparePanel.ts`) — the spin filter:
  - Clusters the same story across outlets; groups coverage into mainstream / independent / state-affiliated / local press.
  - **Talking-point detection** (`src/utils/talking-points.ts`): shared-phrase analysis across distinct outlets; distinguishes wire syndication (normal) from coordinated messaging (flagged); loaded-language detection; narrative sync score.
  - **NCI Engineered Reality Score** (`src/utils/nci-score.ts`): 20-indicator rubric, 1–5 each, normalized 0–100 with tier bands (0–20 low → 81–100 extreme). ~13 indicators auto-score from live headline data; the full rubric (beneficiaries, missing info, cherry-picked stats, fallacies, historical parallels) is scored by your local AI on demand. The scale measures indicators, not proof.
- **`OLLAMA_EXTRA_HOSTS`** env (server): comma-separated extra hostnames allowed for server-side Ollama (e.g. a tunnel to your home PC).

## Local AI (Ollama) — first-class

Coverage Compare calls Ollama **from the browser**. `ollamaCompare` in `src/components/CoverageComparePanel.ts` POSTs to `{OLLAMA_API_URL}/v1/chat/completions` (default model `llama3.1:8b`). That local path stays first-class. Cloud keys are a fallback only when Ollama is off. Do not replace this with a cloud-only provider.

1. Install [Ollama](https://ollama.com/download) and pull a model, e.g.:
   `ollama pull llama3.1:8b` (or a bigger model — your hardware can take it).
2. **Allow browser access** from the production origin (required for the deployed site to reach Ollama on your machine):
   - Windows: System Properties → Environment Variables → add `OLLAMA_ORIGINS` = `https://thepublicdispatch.com` (or `*`), then restart Ollama.
   - Linux/macOS: `OLLAMA_ORIGINS='https://thepublicdispatch.com' ollama serve`
3. In the app: Settings → **Ollama local summarization** → set
   `OLLAMA_API_URL` = `http://localhost:11434` and pick your model.
4. The AI Compare and Full NCI Score buttons in Coverage Compare then run on that browser path. No cloud keys needed.

## Running locally

```bash
npm install --ignore-scripts   # sharp may fail to fetch binaries in some sandboxes; it's only needed for blog OG images
npm run dev                    # http://localhost:3000
```

## Production deploy (Netlify)

The live site is <https://thepublicdispatch.com>. Read `netlify.toml` and `netlify/functions/` before changing the deploy.

Committed functions on `main` are only:

- `netlify/functions/health.js` → `/api/health`
- `netlify/functions/bootstrap.js` → `/api/bootstrap`
- `netlify/functions/wm-session.js` → `/api/wm-session`

The `/api/*` redirect in `netlify.toml` (lines 21–24) is status 200 and is not `force = true`, so those three functions are not shadowed. Every other `/api/*` path still 200-rewrites to `https://brians-world-monitor.vercel.app`. That host is **retired**. Draft PR #29 adds more same-origin functions and is not merged.

**Known gap:** the exact Netlify production SHA is unconfirmed. The live site appears to run code that is not on `main` (`/desk-favico` icons and a postal-code location gate are not in git). An Oct 7 2026 audit saw `GET https://thepublicdispatch.com/api/seismology/v1/list-earthquakes` return 200 from Netlify, which `main`'s three functions plus the retired-host proxy do not explain.

**Do not redeploy `main`. Do not change that `/api/*` proxy until the production SHA is confirmed and same-origin functions serve each path.**

No env vars are required in git for core local functionality. Optional keys unlock extra feeds (names only, in `.env.example`): `GROQ_API_KEY` (AI fallback when Ollama is off), `FINNHUB_API_KEY` (markets), `NASA_FIRMS_API_KEY` (fires), and others. Do not commit values.

## Tests

```bash
npx tsx --test tests/talking-points.test.mts tests/nci-score.test.mts
```

## Lighting up every section (audit 2026-07-23)

Browser-audited every panel. Three groups. The host notes below are updated for Netlify; the panel inventory is the 2026-07-23 audit.

**Live now (25 sections, no setup):** all news sections (World, US, Europe,
Middle East, Africa, LatAm, Asia, Energy, Gov, Think Tanks, Science,
Archaeology, Finance, Tech, AI, Layoffs), Coverage Compare, AI Insights,
Threat Timeline, Country Instability, Strategic Risk, Intel Feed,
Infrastructure Cascade, Displacement, Airline Intel.

**Live on <https://thepublicdispatch.com> when that `/api/*` path is actually served:** Markets, Crypto, Stablecoins, Earthquakes/Natural events, Predictions (Polymarket), World Clock, Weather, Sanctions, National Debt, Disease Outbreaks. The dev server has no function runtime. On `main`, only `/api/health`, `/api/bootstrap`, and `/api/wm-session` are same-origin Netlify functions. Earthquakes returned 200 from Netlify in the Oct 7 2026 audit; that path is part of the unconfirmed production SHA, not proof that `main` serves it.

**Live with API keys** (set the names on the Netlify site environment and, for seeders, as GitHub Actions secrets). Do not redeploy `main` to pick up site env until the production SHA is confirmed. Never commit values.

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

```bash
SMOKE_URL=https://thepublicdispatch.com/dashboard node scripts/operator-no-llm-smoke.mjs
```

`scripts/operator-no-llm-smoke.mjs` defaults to the retired host if `SMOKE_URL` is unset. Always set it.

`scripts/panel-audit.mjs` walks every rendered panel:

```bash
SMOKE_URL=https://thepublicdispatch.com node scripts/panel-audit.mjs
```

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
  After a confirmed production deploy, hard-refresh. If an old layout is still stuck, clear
  site data for the app origin.
- `/api/wm-session` fail-opens if Upstash rate-limit Redis is exhausted so
  a free-tier 500k-command cap cannot 503 the whole dashboard.
- Dashboard **loads Redis data once per page load**. Refresh the browser
  (F5) to update Redis-backed panels. Redis-backed API rate limits are
  skipped on this fork (one operator). Seeders run twice a day (06:00 and
  18:00 UTC). Together that is what keeps command count near Free.
- **Telegram Intel ticks every 60s** while the tab is visible (`telegramIntel` in `src/config/variants/base.ts`). The client reads `/api/telegram-feed`, not Redis. OSINT, Middle East, cyber, conflict, breaking, and
  geopolitics are client-side tabs on that same feed (up to 200 posts).
  Fresh breaking/conflict/Middle East posts (last 15 min) also raise the
  breaking-news banner. The default `full` poll set includes the 8
  tech/cyber channels.
- **Israel Sirens** polls `/api/oref-alerts` every 60s on its own loop (`startOrefPolling` in `src/services/oref-alerts.ts`), not Redis.
- Polymarket stays F5-only: `listPredictionMarkets` reads Redis bootstrap.
  Do not add AIS, predictions, or other Redis surfaces to
  `OPERATOR_LIVE_TICK_PANELS`.

## Seeded panels — Upstash Redis + scheduled seeders

Many panels render from a Redis cache that a background job fills. Two pieces:

**1. Upstash Redis (free) — the cache.**

- Sign up at <https://upstash.com> → Create Database → Redis → pick a region →
  copy the **REST URL** and **REST TOKEN** (the "REST API" section, not the
  redis:// URL). Do not commit or paste those values into docs.
- Add BOTH names in two places, same values:
  - **Netlify site environment** (not Vercel): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, so the app can read the cache. Do not redeploy `main` to apply them until the production SHA is confirmed.
  - **GitHub** → repo → Settings → Secrets and variables → Actions → New
    repository secret: same two names (so the seeder job writes the cache).

**2. Scheduled seeders — `.github/workflows/seed-data.yml`.**

The cron is `0 6,18 * * *` (06:00 and 18:00 UTC), not every 30 minutes. It sweeps `scripts/seed-*.mjs` and writes to Upstash Redis. Trigger the first run manually: repo → Actions → "Seed Data" → Run workflow. Seeders whose API key is missing skip silently, so it works with just Redis and lights up more panels as you add keys.

**Seed Freshness Monitor** (`.github/workflows/seed-freshness-monitor.yml`) skips the scheduled check unless Deploy Gate status `gate` is `success`. A green badge while the Deploy Gate is red does not mean seeds are fresh.

**Data-source keys** (add as GitHub Actions secrets for seeders; the two request-time ones — Finnhub, Groq — also belong in the Netlify site environment):

| Secret | Free signup | Lights up |
| --- | --- | --- |
| `FINNHUB_API_KEY` | finnhub.io | Markets depth, Sector Heatmap, Breadth (also set on Netlify) |
| `GROQ_API_KEY` | console.groq.com | Cloud AI fallback for summaries/NCI when Ollama is off (also set on Netlify) |
| `NASA_FIRMS_API_KEY` | firms.modaps.eosdis.nasa.gov | Fires, Thermal Escalation |
| `FRED_API_KEY` | fred.stlouisfed.org/docs/api/api_key.html | Economic calendar, macro series |
| `EIA_API_KEY` | eia.gov/opendata | Oil Inventories, Energy Complex, electricity prices |
| `AISSTREAM_API_KEY` | aisstream.io | Ship tracking, Hormuz Tracker |
| `ACLED_ACCESS_TOKEN` | acleddata.com (researcher signup) | Armed Conflict Events |
| `AVIATIONSTACK_API` | aviationstack.com | Flight schedules |

After adding GitHub secrets, re-run the Seed Data workflow. Do not redeploy `main` just to load Netlify env. Then re-check panels with:

```bash
SMOKE_URL=https://thepublicdispatch.com node scripts/panel-audit.mjs
```

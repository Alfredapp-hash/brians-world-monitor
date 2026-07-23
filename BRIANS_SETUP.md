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

`scripts/panel-audit.mjs` re-runs the audit against any URL
(`SMOKE_URL=https://your-app.vercel.app node scripts/panel-audit.mjs`).

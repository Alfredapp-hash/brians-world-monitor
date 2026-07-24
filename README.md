# JSA's Monitor

**Real-time intelligence dashboard with a spin filter.** JSA's Monitor tracks
world geopolitics, financial markets, science, and archaeology news from
hundreds of sources — then shows you how the same story is being framed by
different outlets, which talking points are propagating, and how engineered
the coverage looks.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![X: @JSAsmonitor](https://img.shields.io/badge/X-@JSAsmonitor-000000?style=flat&logo=x&logoColor=white)](https://x.com/JSAsmonitor)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/BCHZDq8Xt)

**Live:** <https://brians-world-monitor.vercel.app>

---

## The Spin Filter

What sets JSA's Monitor apart from a normal news dashboard:

- **Coverage Compare** — pick a story and see, side by side, which outlets
  covered it, which ignored it, and how their framing diverges.
- **Talking-point detection** — recurring phrases and framings are surfaced
  as they propagate across outlets, so coordinated language stands out.
- **NCI "Engineered Reality" scoring** — every story cluster gets a
  Narrative Coherence Index score estimating how organic vs. engineered the
  coverage pattern looks. The scoring rubric is public: see
  [/methodology.html](https://brians-world-monitor.vercel.app/methodology.html).
- **Local AI via Ollama** — summaries and analysis can run entirely on your
  own machine. No cloud API keys required.

## Key Features

- **500+ curated news feeds** aggregated across geopolitics, finance,
  science, and archaeology, synthesized into briefs
- **Dual map engine** — 3D globe (globe.gl) and WebGL flat map (deck.gl)
  with terrain basemap, grouped layer controls, and 57 map layer types
- **Country Instability Index** — server-authoritative stress scoring with
  conflict, economic, and climate signals
- **Finance radar** — 29 stock exchanges, commodities, crypto, and a
  multi-signal market composite
- **Typed API surface** — Protocol Buffers (281 protos, 35 services)
- **25 languages** with native-language feeds and RTL support
- **PWA + desktop** — installable web app, native desktop build (Tauri 2)

## Quick Start

```bash
npm install
npm run dev            # Vite dev server (full variant by default)
```

Production build of the dashboard:

```bash
VITE_VARIANT=full npx vite build   # or: npm run build:full
```

No API keys are needed for the core dashboard. Optional providers (AI
summaries, premium data) are configured through environment variables — see
`.env.example` and `SELF_HOSTING.md`.

For local AI, install [Ollama](https://ollama.com) and enable it in the app's
AI settings.

## Data Pipeline

The live deployment does not depend on any upstream infrastructure.
Scheduled **GitHub Actions seeders** fetch and normalize source datasets
(conflict events, economic indicators, climate anomalies, and more) and
publish them to **Upstash Redis**, which the dashboard and its API routes
read at runtime. See `.github/workflows/seed-data.yml` and
`BRIANS_SETUP.md` for the full setup.

## Links

- **About:** [/about.html](https://brians-world-monitor.vercel.app/about.html)
- **NCI methodology:** [/methodology.html](https://brians-world-monitor.vercel.app/methodology.html)
- **X (Twitter):** [@JSAsmonitor](https://x.com/JSAsmonitor)
- **Discord:** <https://discord.gg/BCHZDq8Xt>

## License

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0) —
see [LICENSE](LICENSE). If you run a modified version as a network service,
the AGPL requires you to offer its source to your users.

JSA's Monitor began as a fork of worldmonitor by koala73 (AGPL-3.0) and has
since diverged as an independent project.

# Sprint: "Enterprise Skin" — Deep Visual Overhaul of JSA's Monitor

**Goal.** Take the dashboard from "credible layout with hobby-project signals" to a coherent, enterprise-grade visual identity — in one sprint, verified by real screenshots before and after.

**Method.** Three expert audits ran first (design-system architecture, rendered-UI screenshot audit at 1920/1366/390, component-UX audit). Every item below traces to a specific audited finding with file evidence. Implementation is split into four expert workstreams with strict file ownership so agents never collide, followed by a hard verification gate.

---

## What the audits found (condensed)

**Token drift.** 256 distinct hard-coded hex colors in CSS (~1,900 uses) vs 86 defined custom properties; another 889 hex literals inside TS components. 45 distinct font sizes, 42 z-index values (−1 → 100000), 18 border radii, zero `--space-*`/`--radius-*`/`--z-*` tokens. The entire brand identity rides on a 90-line `brians-theme.css` that wins by cascade luck against a 26,000-line `main.css`.

**Brand incoherence.** The header says "MONITOR @eliehabib", the footer says "JSA'S MONITOR · @ELIEHABIB", the mobile header says "World Monitor" — three product names in one build, with the upstream author's handle still shipping. The upstream green/blue palette (150+ green uses, 94+ blue) still dominates panels; the brand amber `#f0a832` appears just 12 times while three near-miss ambers (`#f59e0b` ×46, `#ffaa00` ×34, `#eab308` ×22) impersonate it.

**Offline mode looks crashed.** In any degraded state the page shows a wall of red UNAVAILABLE pills, the literal string "forecast request failed", duplicate "unavailable" lines, a LIVE NEWS panel that is ~40% dead black space, webcam tiles as 300px maroon voids, and two blank skeleton boxes in the header that never fill. First impressions are made here.

**Component sprawl.** 135 distinct `-btn` classes (a shared `.btn` system exists but is used 50× vs 241× bespoke); 107 badge/chip classes; ~28 modal/overlay conventions each with its own backdrop and hand-rolled focus trap; 36 ad-hoc empty-state variants because `Panel` has `showLoading`/`showError` but no `showEmpty`. The flagship Coverage Compare card stacks 14–16 competing chips before the user reads a word, with six colliding color systems (green means "independent," "safe," *and* "live").

**Broken chrome moments.** ⌘K command palette opens *underneath* the auto-opened workspace modal; the workspace modal has no scrim; the Discord toast is off-palette indigo and overlaps the footer; emoji glyphs (🔔 🔍) sit in an otherwise line-icon UI; mobile clips chips under the settings gear and wraps the primary button to two lines.

**Contrast.** `--text-dim` resolves to `#6b6b6b`/`#888` on `#0a0c10` (≈3.5:1 — fails WCAG AA) and is applied at 9–10px.

---

## Workstream A — Token foundation & brand color unification

*Owner: design-systems agent. Files: `src/styles/brians-theme.css`, `src/styles/main.css` (surgical), `src/styles/panels.css` (color values only).*

1. Promote `brians-theme.css` to a real token layer: add `--space-1..8` (4px scale), `--radius-sm/md/lg/pill`, `--z-base/panel/dropdown/toast/modal/palette` ladder, `--text-size-xs/sm/md/lg` steps matching the dominant 9/10/11/12px usage.
2. One amber. Remap the three impostor golds (`#f59e0b`, `#ffaa00`, `#eab308`) to the brand `--accent #f0a832` (or its derived dim/bright variants) everywhere they appear in CSS.
3. Kill the upstream leftovers with highest visibility: `#8b949e` (GitHub gray, 28×), `#58a6ff` (GitHub blue, 20×) → tokens.
4. Fix contrast: introduce `--text-dim: #a9a49b` (≥4.5:1 on `#0a0c10`) and repoint the failing `#888`/`#6b6b6b`/`#999` dim-text uses in the cc- block and panel chrome.
5. Define the semantic status scale once — `--status-info/watch/warn/alert` — for Workstreams B and D to consume.
6. Extend the amber `:focus-visible` ring beyond its current 4 selectors to all interactive primitives.

**Acceptance:** app builds; dashboard-critical-css test stays green; grep shows impostor ambers reduced to ~0 in CSS; contrast spot-checks pass.

## Workstream B — Degraded-mode redesign (empty/loading/error states)

*Owner: UX-engineering agent. Files: `src/components/Panel.ts`, `src/styles/base-layer.css` + new `src/styles/states.css`, targeted components (LiveNews/webcams/forecast/threat-timeline error strings), header placeholder logic.*

1. Add `Panel.showEmpty(icon, message, hint?)` to the base class — one designed empty state (dim icon, one sentence-cased line, optional retry) — and restyle `showError` to match.
2. Demote UNAVAILABLE badges from alarm-red to neutral gray with an amber accent only for genuinely actionable errors. A dashboard with APIs down should look intentional, not crashed.
3. Humanize raw error strings: "forecast request failed" → "Forecasts are warming up — retrying automatically"; remove duplicate unavailable lines in Threat Timeline.
4. LIVE NEWS: vertically center the "Play live feed" state in its well; cap the well height to kill the 40% black void.
5. Webcam tiles: styled gradient poster cards (location name centered, fixed aspect ratio) instead of maroon voids.
6. Header: collapse (display:none) the two skeleton placeholder boxes until they have real content.

**Acceptance:** offline screenshots show zero raw error strings, zero red walls, no dead voids; all tests green.

## Workstream C — Brand unification & chrome de-crowding

*Owner: brand/product agent. Files: `src/app/panel-layout.ts`, footer/mobile-header sources, Discord toast component, emoji sites. `index.html` only if unavoidable (i18n shell/CSP guards!).*

1. One name everywhere: "JSA's Monitor" in desktop header, mobile header, and footer; remove `@eliehabib` credit links (upstream attribution stays in README/AGPL, not chrome).
2. Header zones: brand | context (region/mission) | controls; demote the 6-option variant switcher and vanity links; target ≤12 interactive elements at rest.
3. Discord toast: recolor from off-palette indigo to theme surface + amber; fix its footer overlap; make it dismissible-sticky.
4. Replace emoji glyphs (🔔, 🔍) with inline SVG line icons matching the existing icon language.
5. Map layer chips: one consistent chip width/style, one info-affordance style; auto-collapse the chip wall below 1500px so it never sits on top of map geography.

**Acceptance:** screenshots show a single product name at all three breakpoints; no emoji in chrome; toast on-palette; i18n-english-shell + CSP-hash tests green.

## Workstream D — Flagship card hierarchy + modal stacking (runs after A)

*Owner: senior front-end agent. Files: `src/components/CoverageComparePanel.ts`, `src/styles/panels.css` (cc- block), modal z-index sites.*

1. Three-tier story card: **Tier 1** (always): NCI score badge + tier stripe, title, source count, single worst flag. **Tier 2** (one summary line): sync meter compressed to a word + phrase count. **Tier 3** (inside `<details>`): everything else — full flags, phrases, loaded terms, 20-row NCI table, source groups, local coverage. Cap the collapsed summary row at 3 chips.
2. Recolor cc- chips onto the Workstream-A semantic scale so green/red each mean exactly one thing; source-class groups get neutral chips with a colored left border instead of six full-color families.
3. Compact mode: `@media` for narrow panels — chip row becomes a labeled stack, buttons don't wrap mid-word.
4. Modal stacking: workspace modal gets a proper scrim and closes when ⌘K opens; both adopt the `--z-*` ladder (palette above modal). 
5. Map flagship buttons onto the shared `.btn` variants where drop-in (visual change only, keep cc- hooks for tests).

**Acceptance:** collapsed card shows ≤3 chips + title + score; ⌘K renders above/replaces the workspace modal in a screenshot; cc tests (talking-points, NCI) green.

## Verification gate (blocks the sprint close)

1. `npx tsc --noEmit` typecheck; Biome lint clean.
2. Full `node:test` suite — especially dashboard-critical-css, i18n-english-shell, locale-completeness, CSP-hash, panel-config-guardrails, feed parity.
3. Rebuild `VITE_VARIANT=full`; re-run the Playwright audit script at 1920/1366/390; visually compare against the before-shots in `audit-shots/`.
4. Commit narrative-grouped changes; push to `brian/main`; Vercel auto-deploys.

## Explicitly out of scope (next sprint candidates)

Migrating the 889 TS-embedded hex literals (map/stock/gold panels) to tokens; collapsing the 28 modals into one Modal primitive; deleting all 135 `-btn` classes (this sprint only converges the flagship + new work onto `.btn`); the happy-theme/critical-CSS third-theme reconciliation; full mobile redesign beyond the targeted clip/wrap fixes.

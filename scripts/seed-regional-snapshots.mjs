#!/usr/bin/env node
// @ts-check
/**
 * Regional Intelligence snapshot seeder.
 *
 * Computes a RegionalSnapshot per region using deterministic scoring across
 * seven balance axes, derives a regime label, scores actors, evaluates
 * structured trigger thresholds, builds normalized scenario sets, resolves
 * pre-built transmission templates, and persists to Redis with idempotency.
 *
 * Phase 1 (PR2): LLM narrative layer added. One structured-JSON call per
 * region via generateRegionalNarrative(), ship-empty on any failure. The
 * 'global' region is skipped inside the generator. Provider + model flow
 * through SnapshotMeta.narrative_provider / narrative_model.
 *
 * Architecture: docs/internal/pro-regional-intelligence-upgrade.md
 * Engineering:  docs/internal/pro-regional-intelligence-appendix-engineering.md
 * Scoring:      docs/internal/pro-regional-intelligence-appendix-scoring.md
 *
 * Run via the seed bundle (recommended) or directly:
 *   node scripts/seed-regional-snapshots.mjs
 */

import { pathToFileURL } from 'node:url';

import {
  loadEnvFile,
  getRedisCredentials,
  writeExtraKeyWithMeta,
  acquireLockSafely,
  releaseLock,
  extendExistingTtl,
} from './_seed-utils.mjs';
// Use scripts/shared mirror rather than the repo-root shared/ folder: the
// Railway bundle service sets rootDirectory=scripts, so `../shared/` resolves
// to filesystem / on deploy and the import fails with ERR_MODULE_NOT_FOUND.
// scripts/shared/* is kept in sync with shared/* via tests.
import { REGIONS, GEOGRAPHY_VERSION } from './shared/geography.js';

import { computeBalanceVector, SCORING_VERSION } from './regional-snapshot/balance-vector.mjs';
import { buildRegimeState } from './regional-snapshot/regime-derivation.mjs';
import { scoreActors } from './regional-snapshot/actor-scoring.mjs';
import { evaluateTriggers } from './regional-snapshot/trigger-evaluator.mjs';
import { buildScenarioSets } from './regional-snapshot/scenario-builder.mjs';
import { resolveTransmissions } from './regional-snapshot/transmission-templates.mjs';
import { collectEvidence } from './regional-snapshot/evidence-collector.mjs';
import { buildPreMeta, buildFinalMeta } from './regional-snapshot/snapshot-meta.mjs';
import { diffRegionalSnapshot, inferTriggerReason } from './regional-snapshot/diff-snapshot.mjs';
import { persistSnapshot, readLatestSnapshot } from './regional-snapshot/persist-snapshot.mjs';
import { ALL_INPUT_KEYS, ALL_META_KEYS } from './regional-snapshot/freshness.mjs';
import { generateSnapshotId, unwrapEnvelope } from './regional-snapshot/_helpers.mjs';
import { generateRegionalNarrative, emptyNarrative } from './regional-snapshot/narrative.mjs';
import { emitRegionalAlerts } from './regional-snapshot/alert-emitter.mjs';
import { buildMobilityState } from './regional-snapshot/mobility.mjs';
import { recordRegimeTransition } from './regional-snapshot/regime-history.mjs';

loadEnvFile(import.meta.url);

const SEED_META_KEY = 'intelligence:regional-snapshots';
const LOCK_DOMAIN = 'regional-snapshots';
// 5 min: generous headroom over the parallelized per-region work (compute +
// narrative LLM call + persist + alerts + history), well under the 6h cron
// cadence, so a genuinely stuck run releases the lock for the next tick
// instead of wedging every subsequent invocation.
const LOCK_TTL_MS = 5 * 60 * 1000;
// TTL applied to the :latest key of a region whose compute/persist threw, so
// a transient failure doesn't leave that region's data expiring on the old
// 90-day schedule started by its last successful persist while readers keep
// serving it as "fresh" between now and the next successful run.
const PARTIAL_FAILURE_TTL_EXTENSION_SECONDS = 24 * 60 * 60; // 24h

/**
 * Named-argument wrapper around `_seed-utils.mjs`'s `writeExtraKeyWithMeta`,
 * scoped to this file only. The shared helper's 6-positional-arg signature
 * (`ttlSec` appears in both slot 3 and slot 6) is fragile at this call site —
 * see docs/archive/todos/183-pending-p2-writeextrakeywithmeta-positional-args-fragile.md.
 * Left the shared helper's signature untouched since ~157 other seeders call it.
 *
 * @param {{ canonicalKey: string, payload: unknown, ttlSec: number, persisted: number, metaKey: string }} args
 */
async function writeSummaryWithMeta({ canonicalKey, payload, ttlSec, persisted, metaKey }) {
  return writeExtraKeyWithMeta(canonicalKey, payload, ttlSec, persisted, metaKey, ttlSec);
}

/**
 * Read every input key + every metaKey companion in a single pipeline.
 * metaKeys carry {fetchedAt, recordCount} for inputs whose data payload
 * has no top-level timestamp (mobility sources). See freshness.mjs.
 *
 * @returns {Promise<{ sources: Record<string, any>, metaSources: Record<string, any> }>}
 */
async function readAllInputs() {
  const { url, token } = getRedisCredentials();
  const keys = [...ALL_INPUT_KEYS, ...ALL_META_KEYS];
  const pipeline = keys.map((k) => ['GET', k]);
  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Redis pipeline read: HTTP ${resp.status}`);
  const results = await resp.json();

  /** @type {Record<string, any>} */
  const sources = {};
  /** @type {Record<string, any>} */
  const metaSources = {};
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const isInput = i < ALL_INPUT_KEYS.length;
    const target = isInput ? sources : metaSources;
    const raw = results[i]?.result;
    if (raw === null || raw === undefined) {
      target[key] = null;
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      // Input payloads written via the relay's envelopeWrite ({ _seed, data })
      // must be unwrapped to their flat shape so compute modules read the right
      // fields. seed-meta:* payloads are always flat and pass through untouched.
      target[key] = isInput ? unwrapEnvelope(parsed) : parsed;
    } catch {
      target[key] = null;
    }
  }
  return { sources, metaSources };
}

/**
 * Run the full compute pipeline for one region in the canonical order.
 *
 *   1. (sources already read by caller)
 *   2. pre_meta
 *   3. balance vector
 *   4. actors
 *   5. triggers (BEFORE scenarios)
 *   6. scenarios (normalized)
 *   7. transmissions
 *   8. mobility (v1 adapter — airports, airspace, reroute_intensity, NOTAMs)
 *   9. evidence
 *   10. snapshot_id
 *   11. read previous + derive regime
 *   12. build snapshot-for-prompt (no narrative yet)
 *   13. LLM narrative call (ship-empty on failure; skipped for 'global')
 *   14. splice narrative into tentative snapshot
 *   15. diff → trigger_reason
 *   16. final_meta with narrative_provider/narrative_model
 */
async function computeSnapshot(regionId, sources, metaSources = {}, preMeta = null) {
  // Step 2: pre-meta (metaSources carries seed-meta:*.fetchedAt for inputs
  // whose data payloads have no top-level timestamp — see freshness.mjs).
  // pre_meta depends only on `sources`/`metaSources`, not `regionId`, so
  // main() computes it once and passes it in via `preMeta` to avoid 8
  // identical calls (one per region) with the same result. The internal
  // fallback keeps this function usable standalone (e.g. future tests).
  const { pre } = preMeta ?? buildPreMeta(sources, SCORING_VERSION, GEOGRAPHY_VERSION, metaSources);

  // Step 3: balance vector
  const { vector: balance } = computeBalanceVector(regionId, sources);

  // Step 4: actors
  const { actors, edges } = scoreActors(regionId, sources);

  // Step 5: triggers (before scenarios)
  const triggers = evaluateTriggers(regionId, sources, balance);

  // Step 6: scenarios (normalized to 1.0 per horizon)
  const scenarioSets = buildScenarioSets(regionId, sources, triggers);

  // Step 7: transmissions (matched to active triggers)
  const transmissionPaths = resolveTransmissions(regionId, triggers);

  // Step 8: mobility v1 — adapters over existing Redis inputs:
  // aviation:delays:{faa,intl}, aviation:notam:closures:v2,
  // intelligence:gpsjam:v2, military:flights:v1. Pure, never throws.
  // See Phase 2 PR2 notes in scripts/regional-snapshot/mobility.mjs.
  const mobility = buildMobilityState(regionId, sources);

  // Step 9: evidence chain
  const evidence = collectEvidence(regionId, sources);

  // Step 10: snapshot_id
  const snapshotId = generateSnapshotId();

  // Step 11: read previous + derive regime. Must happen before narrative
  // generation because the prompt consumes the regime label.
  const previous = await readLatestSnapshot(regionId).catch(() => null);
  const previousLabel = previous?.regime?.label ?? '';
  const regime = buildRegimeState(balance, previousLabel, '');

  // Step 12: snapshot-shaped input for the narrative prompt. The narrative
  // generator reads regime/balance/actors/scenarios/triggers/evidence from
  // this object and does NOT inspect `meta` or the placeholder narrative.
  // Meta here is a throwaway — the real meta is built after diff so
  // trigger_reason and narrative_* can flow in together.
  const snapshotForPrompt = {
    region_id: regionId,
    generated_at: Date.now(),
    meta: buildFinalMeta(pre, { snapshot_id: snapshotId, trigger_reason: 'scheduled_6h' }),
    regime,
    balance,
    actors,
    leverage_edges: edges,
    scenario_sets: scenarioSets,
    transmission_paths: transmissionPaths,
    triggers,
    mobility,
    evidence,
    narrative: emptyNarrative(),
  };

  // Step 13: LLM narrative. Ship-empty on any failure — the snapshot remains
  // valuable without the narrative, and the narrative generator itself
  // never throws. 'global' is skipped inside the generator.
  const region = REGIONS.find((r) => r.id === regionId);
  const narrativeResult = region
    ? await generateRegionalNarrative(region, snapshotForPrompt, evidence)
    : { narrative: emptyNarrative(), provider: '', model: '' };

  // Step 14: tentative snapshot with the real narrative spliced in.
  const tentativeSnapshot = {
    ...snapshotForPrompt,
    narrative: narrativeResult.narrative,
  };

  // Step 15: diff against previous for trigger_reason inference
  const diff = diffRegionalSnapshot(previous, tentativeSnapshot);
  const triggerReason = inferTriggerReason(diff);

  // Backfill the regime's transition_driver now that we have the diff-derived
  // trigger_reason. Step 11 built the regime object before the diff existed
  // so the driver was empty; patching here ensures both the persisted snapshot
  // AND the regime-history entry carry the real driver (PR #2981 review fix).
  if (diff.regime_changed && triggerReason !== 'scheduled_6h') {
    regime.transition_driver = triggerReason;
    tentativeSnapshot.regime = regime;
  }

  // Step 16: final_meta with diff-derived trigger_reason and narrative metadata
  const finalMeta = buildFinalMeta(pre, {
    snapshot_id: snapshotId,
    trigger_reason: triggerReason,
    narrative_provider: narrativeResult.provider,
    narrative_model: narrativeResult.model,
  });

  // Return the snapshot WITHOUT the diff. The diff is a runtime artifact for
  // alert emission; persisting it would leak a non-RegionalSnapshot field into
  // Redis and break Phase 1 proto codegen consumers.
  /** @type {import('../shared/regions.types.js').RegionalSnapshot} */
  const snapshot = { ...tentativeSnapshot, meta: finalMeta };
  return { snapshot, diff };
}

/**
 * Run compute + persist + best-effort side-effects for one region. Never
 * throws — failures are caught and reported as a `'failed'` outcome so
 * `Promise.allSettled` callers never need to inspect the rejection branch.
 *
 * Regions are fully independent (dedup keys, data keys, and :latest
 * pointers are all region-scoped), so this is safe to run concurrently
 * across all regions from `main()` — see
 * docs/archive/todos/172-pending-p2-sequential-readlatestsnapshot-1600ms-overhead.md
 * and docs/archive/todos/173-pending-p2-sequential-per-region-persist-1600ms.md.
 *
 * @param {{ id: string }} region
 * @param {Record<string, any>} sources
 * @param {Record<string, any>} metaSources
 * @param {ReturnType<typeof buildPreMeta> | null} [preMeta]
 */
async function processRegion(region, sources, metaSources, preMeta = null) {
  try {
    const { snapshot, diff } = await computeSnapshot(region.id, sources, metaSources, preMeta);
    const result = await persistSnapshot(snapshot);
    if (!result.persisted) {
      console.log(`[${region.id}] skipped: ${result.reason}`);
      return { status: /** @type {const} */ ('skipped'), region: region.id, reason: result.reason };
    }

    console.log(`[${region.id}] persisted regime=${snapshot.regime.label} confidence=${snapshot.meta.snapshot_confidence} triggers=${snapshot.triggers.active.length} reason=${snapshot.meta.trigger_reason}`);

    // Emit state-change alerts for this diff. Best-effort — never blocks or
    // throws out of the caller. Alerts are deduped on a 6h window by
    // wm:notif:scan-dedup:{eventType}:{hash}, matching the cron cadence.
    try {
      const alertResult = await emitRegionalAlerts(region, snapshot, diff);
      if (alertResult.events.length > 0) {
        console.log(`[${region.id}] alerts: ${alertResult.enqueued}/${alertResult.events.length} enqueued`);
      }
    } catch (alertErr) {
      const alertMsg = /** @type {any} */ (alertErr)?.message ?? alertErr;
      console.warn(`[${region.id}] alert emitter threw: ${alertMsg}`);
    }

    // Record a regime drift history entry iff this snapshot actually
    // changed the regime label. Steady-state snapshots produce no entry.
    // Best-effort — never blocks persist. See regime-history.mjs.
    try {
      const historyResult = await recordRegimeTransition(region, snapshot, diff);
      if (historyResult.recorded) {
        console.log(`[${region.id}] regime drift recorded: ${historyResult.entry?.previous_label || 'none'} → ${historyResult.entry?.label}`);
      }
    } catch (histErr) {
      const histMsg = /** @type {any} */ (histErr)?.message ?? histErr;
      console.warn(`[${region.id}] regime-history threw: ${histMsg}`);
    }

    return {
      status: /** @type {const} */ ('persisted'),
      region: region.id,
      summaryEntry: {
        region: region.id,
        regime: snapshot.regime.label,
        confidence: snapshot.meta.snapshot_confidence,
        active_triggers: snapshot.triggers.active.length,
        trigger_reason: snapshot.meta.trigger_reason,
      },
    };
  } catch (err) {
    const errMsg = String(/** @type {any} */ (err)?.message ?? err);
    console.error(`[${region.id}] FAILED: ${errMsg}`);
    // Best-effort: extend this region's :latest TTL so a transient
    // compute/persist failure doesn't leave last-known-good data expiring
    // on its old clock while readers keep treating it as fresh in the
    // meantime. extendExistingTtl never throws.
    await extendExistingTtl([`intelligence:snapshot:v1:${region.id}:latest`], PARTIAL_FAILURE_TTL_EXTENSION_SECONDS);
    return { status: /** @type {const} */ ('failed'), region: region.id, error: errMsg };
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`[regional-snapshots] Starting compute for ${REGIONS.length} regions`);

  // Distributed lock: without it, two overlapping invocations (e.g. a
  // Railway container restart racing the previous run, or a manual run
  // overlapping the cron) could double-execute concurrently, each computing
  // and persisting its own summary. See
  // docs/archive/todos/174-pending-p2-seeder-bypasses-runseed-gold-standard.md.
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const lockResult = await acquireLockSafely(LOCK_DOMAIN, runId, LOCK_TTL_MS, { label: LOCK_DOMAIN });
  if (lockResult.skipped) {
    console.warn('[regional-snapshots] SKIPPED: Redis unavailable during lock acquisition');
    return;
  }
  if (!lockResult.locked) {
    console.log('[regional-snapshots] SKIPPED: another regional-snapshots run is already in progress');
    return;
  }

  try {
    // Step 1: read all inputs once (shared across regions), plus seed-meta
    // companions for inputs whose payloads lack top-level timestamps.
    const { sources, metaSources } = await readAllInputs();
    const presentKeys = Object.entries(sources).filter(([, v]) => v !== null).length;
    const presentMetaKeys = Object.entries(metaSources).filter(([, v]) => v !== null).length;
    console.log(`[regional-snapshots] Read inputs: ${presentKeys}/${ALL_INPUT_KEYS.length} keys present, ${presentMetaKeys}/${ALL_META_KEYS.length} meta keys present`);

    // Precompute `_caseFileText` once per forecast (not per-region-per-module)
    // so actor-scoring / balance-vector (computeAllianceCohesion) / scenario-builder
    // all read the same normalized, lowercased case-file text instead of each
    // re-running JSON.stringify(caseFile ?? signals) per forecast per region.
    // Mutates the shared forecast objects in `sources['forecast:predictions:v2']`
    // in place, before the per-region fan-out below, so every region's calls
    // into those modules see the field already populated.
    // See docs/archive/todos/190-pending-p3-many-redundant-jsonstringify-casefile-loops.md
    const forecastPredictions = sources['forecast:predictions:v2']?.predictions;
    if (Array.isArray(forecastPredictions)) {
      for (const f of forecastPredictions) {
        if (!f || typeof f !== 'object') continue;
        try {
          f._caseFileText = JSON.stringify(f?.caseFile ?? f?.signals ?? {}).toLowerCase();
        } catch {
          f._caseFileText = '{}';
        }
      }
    }

    // pre_meta (confidence/missing_inputs/stale_inputs/valid_until) depends
    // only on `sources`/`metaSources`, not on regionId, so compute it once
    // here instead of once per region (8x identical calls previously).
    // See docs/archive/todos/192-pending-p3-perf-micro-cleanups.md (#1).
    const preMeta = buildPreMeta(sources, SCORING_VERSION, GEOGRAPHY_VERSION, metaSources);

    // Regions are fully independent, so compute + persist + side-effects run
    // concurrently rather than one-region-at-a-time. This collapses what was
    // 8 sequential rounds of (2 prev-snapshot reads + 2 persist round-trips)
    // into one concurrent round, cutting per-run Redis wall-clock from
    // ~3.4s to well under 1s. Promise.allSettled (rather than Promise.all)
    // so one region's unexpected rejection can't cancel accounting for the
    // others; in practice processRegion never rejects (it catches
    // internally) — this is defense-in-depth against a future regression.
    const outcomes = await Promise.allSettled(
      REGIONS.map((region) => processRegion(region, sources, metaSources, preMeta)),
    );

    let persisted = 0;
    let skipped = 0;
    let failed = 0;
    const summary = [];
    const failedRegions = [];

    for (let i = 0; i < outcomes.length; i += 1) {
      const outcome = outcomes[i];
      const region = REGIONS[i];
      if (outcome.status === 'rejected') {
        failed += 1;
        const errMsg = String(/** @type {any} */ (outcome.reason)?.message ?? outcome.reason);
        failedRegions.push({ region: region.id, error: errMsg });
        console.error(`[${region.id}] FAILED (unhandled rejection): ${errMsg}`);
        continue;
      }
      const result = outcome.value;
      if (result.status === 'persisted') {
        persisted += 1;
        summary.push(result.summaryEntry);
      } else if (result.status === 'skipped') {
        skipped += 1;
      } else {
        failed += 1;
        failedRegions.push({ region: result.region, error: result.error });
      }
    }

    // Health policy:
    //   1. persisted > 0 && failed === 0: write the fresh summary + seed-meta.
    //   2. persisted === 0 && failed === 0: all regions dedup-skipped (e.g., a
    //      retry within the 15min idempotency bucket). Preserve the prior good
    //      summary by skipping the write entirely. api/health.js classifies an
    //      empty `regions: []` + `recordCount: 0` as EMPTY_DATA which flips the
    //      overall health to red, so overwriting on a no-op retry is actively
    //      harmful. The 24h maxStaleMin budget lets the next full run refresh
    //      the payload naturally.
    //   3. failed > 0: skip the meta write so /api/health flips to STALE after
    //      the maxStaleMin budget on persistent degradation instead of silently
    //      reporting OK. The bundle runner's freshness gate retries next cycle.
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (failed === 0 && persisted > 0) {
      // 24h clears the gold-standard >=3x-cron-cadence floor (6h cadence) so
      // a single missed run doesn't blow past the health check's
      // maxStaleMin budget — see
      // docs/archive/todos/174-pending-p2-seeder-bypasses-runseed-gold-standard.md.
      const ttlSec = 24 * 60 * 60;
      await writeSummaryWithMeta({
        canonicalKey: `intelligence:regional-snapshots:summary:v1`,
        payload: { regions: summary, generatedAt: Date.now() },
        ttlSec,
        persisted,
        metaKey: `seed-meta:${SEED_META_KEY}`,
      });
      console.log(`[regional-snapshots] Done in ${elapsed}s: persisted=${persisted} skipped=${skipped} failed=0`);
      return;
    }

    if (failed === 0) {
      // All regions dedup-skipped. Preserve the prior summary and return cleanly.
      console.log(`[regional-snapshots] Done in ${elapsed}s: persisted=0 skipped=${skipped} failed=0 (all dedup-skipped, prior summary preserved)`);
      return;
    }

    console.error(`[regional-snapshots] Done in ${elapsed}s: persisted=${persisted} skipped=${skipped} failed=${failed}`);
    for (const f of failedRegions) {
      console.error(`  [${f.region}] ${f.error}`);
    }
    console.error('[regional-snapshots] Skipping seed-meta write due to partial failure. /api/health will reflect degradation after 24h.');
    // Throw instead of process.exit(1) so callers (e.g. seed-bundle-regional.mjs)
    // can catch and continue with other seeders. The isDirectRun guard below still
    // calls process.exit(1) for standalone invocations.
    throw new Error(`regional-snapshots: ${failed} region(s) failed`);
  } finally {
    // Release regardless of success/throw so the next run isn't blocked for
    // the full LOCK_TTL_MS by a run that completed (or failed cleanly).
    await releaseLock(LOCK_DOMAIN, runId);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`PUBLISH FAILED: ${err?.message || err}`);
    process.exit(1);
  });
}

export { main, computeSnapshot, readAllInputs };

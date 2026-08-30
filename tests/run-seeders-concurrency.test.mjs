// Verifies scripts/run-seeders.sh runs seeders with BOUNDED CONCURRENCY
// instead of strictly sequential, while preserving the existing
// OK/SKIP/FAIL/TIMEOUT classification and the bundle-seeder exemption from
// SEED_TIMEOUT.
//
// Builds a temp directory of synthetic seed-*.mjs stubs (no real Redis /
// upstream calls — the script only needs a truthy UPSTASH_REDIS_REST_TOKEN
// to pass its own fail-loud credential gate) and points run-seeders.sh at
// it via the SEED_SCRIPT_DIR override, so this never touches real seeders
// or real credentials.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_SEEDERS_SH = fileURLToPath(new URL('../scripts/run-seeders.sh', import.meta.url));

// Concurrency cap used for the run. Kept small and deterministic so the
// "never exceeds the cap" assertion is meaningful with only a handful of stubs.
const CONCURRENCY = 3;
// Wrapped (standalone) seeders get killed after this many seconds. Kept
// generous relative to SLOW_OK_MS (below) because this test spawns real
// child node processes, and it runs as one of thousands of suites under
// the full test:data run's own --test-concurrency=16 — on a CPU-constrained
// box (e.g. a 2-core sandbox/CI runner) node startup + event-loop latency
// under that contention can itself eat several hundred ms, which a tight
// margin here turned into flaky false TIMEOUTs.
const SEED_TIMEOUT_SECONDS = 3;

// Six "slow success" stubs, each sleeping this long, prove two things at
// once: (a) more than CONCURRENCY of them never run at the same time
// (bounded), and (b) they don't run one-at-a-time (genuine concurrency —
// the whole run finishes far faster than 6x this duration).
const SLOW_OK_COUNT = 6;
const SLOW_OK_MS = 500;
// Bundle seeders are exempt from SEED_TIMEOUT — this sleeps well past the
// cap and must still classify OK, proving the exemption survived the
// rewrite to bounded concurrency.
const BUNDLE_SLEEP_MS = 4500;
// This one sleeps past SEED_TIMEOUT and IS wrapped, so it must be killed
// and classified TIMEOUT at ~SEED_TIMEOUT_SECONDS, not at its full sleep.
const TIMEOUT_SLEEP_MS = 8000;

/** Run run-seeders.sh against `dir` and wait for it to finish. Concurrency
 * proof no longer comes from an external poller sampling the marker
 * directory on a timer — under this test's own harness (test:data runs
 * thousands of suites at --test-concurrency=16) that poller's setInterval
 * callback can itself get starved on a CPU-constrained box and silently
 * miss the entire overlap window, which is scheduling noise in the *test*,
 * not a real signal about the script under test. Instead each slow-ok stub
 * timestamps its own start/end (see below) with Date.now() calls made in
 * its own process, and the caller reconstructs concurrency from those
 * intervals after the run — immune to how busy the parent test process was. */
function runSeeders(dir, markerDir, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      [RUN_SEEDERS_SH, dir],
      {
        env: {
          ...process.env,
          // Stub credentials — no stub ever talks to Redis, this only
          // needs to be truthy to pass run-seeders.sh's own fail-loud gate.
          UPSTASH_REDIS_REST_TOKEN: 'test-token-not-real',
          UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:0',
          REDIS_TOKEN: '',
          SEED_TIMEOUT: String(SEED_TIMEOUT_SECONDS),
          SEED_CONCURRENCY: String(CONCURRENCY),
          MARKER_DIR: markerDir,
          ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });

    const startedAt = Date.now();
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
}

/** Reconstruct peak overlap from `<markerDir>/slow-ok-<i>.start` /
 * `.end` files (each a Date.now() written by the stub itself). A classic
 * sweep over +1-at-start/-1-at-end events, so it's exact regardless of how
 * coarse or delayed the reader is — there's no live polling to starve. */
function peakOverlapFromMarkers(markerDir, count) {
  const events = [];
  for (let i = 0; i < count; i += 1) {
    const start = Number(readFileSync(join(markerDir, `slow-ok-${i}.start`), 'utf8'));
    const end = Number(readFileSync(join(markerDir, `slow-ok-${i}.end`), 'utf8'));
    events.push([start, 1], [end, -1]);
  }
  // End events sort before start events at the same millisecond so a job
  // that ends exactly when another starts isn't counted as overlapping.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let concurrent = 0;
  let peak = 0;
  let sawMoreThanOneAtOnce = false;
  for (const [, delta] of events) {
    concurrent += delta;
    if (concurrent > peak) peak = concurrent;
    if (concurrent > 1) sawMoreThanOneAtOnce = true;
  }
  return { peakConcurrent: peak, sawMoreThanOneAtOnce };
}

test('run-seeders.sh runs seeders with bounded concurrency and correct classification', async () => {
  const seedDir = mkdtempSync(join(tmpdir(), 'run-seeders-stubs-'));
  const markerDir = mkdtempSync(join(tmpdir(), 'run-seeders-markers-'));

  try {
    // --- fast, near-instant stubs (one of each classification) ---
    writeFileSync(
      join(seedDir, 'seed-fast-ok.mjs'),
      `console.log('fast ok'); process.exit(0);\n`,
    );
    writeFileSync(
      join(seedDir, 'seed-skip-case.mjs'),
      // Last line must match the classifier's skip regex (skip|not set|missing.*key|not found).
      `console.log('SKIPPED: FAKE_API_KEY not set'); process.exit(0);\n`,
    );
    writeFileSync(
      join(seedDir, 'seed-fail-case.mjs'),
      `console.error('synthetic failure'); process.exit(1);\n`,
    );

    // --- standalone seeder that outlives SEED_TIMEOUT -> must be TIMEOUT ---
    writeFileSync(
      join(seedDir, 'seed-timeout-case.mjs'),
      `await new Promise((r) => setTimeout(r, ${TIMEOUT_SLEEP_MS}));\nconsole.log('should not get here');\nprocess.exit(0);\n`,
    );

    // --- bundle seeder that outlives SEED_TIMEOUT but is EXEMPT -> must be OK ---
    writeFileSync(
      join(seedDir, 'seed-bundle-test.mjs'),
      `await new Promise((r) => setTimeout(r, ${BUNDLE_SLEEP_MS}));\nconsole.log('bundle done');\nprocess.exit(0);\n`,
    );

    // --- N "slow success" stubs that each timestamp their own start/end to
    // the marker dir, so the test can reconstruct real concurrency (and its
    // bound) after the run — from data the stubs recorded about themselves,
    // not from an external observer racing the scheduler. ---
    for (let i = 0; i < SLOW_OK_COUNT; i += 1) {
      writeFileSync(
        join(seedDir, `seed-slow-ok-${i}.mjs`),
        [
          `import { writeFileSync } from 'node:fs';`,
          `import { join } from 'node:path';`,
          `const markerDir = process.env.MARKER_DIR;`,
          `writeFileSync(join(markerDir, 'slow-ok-${i}.start'), String(Date.now()));`,
          `await new Promise((r) => setTimeout(r, ${SLOW_OK_MS}));`,
          `writeFileSync(join(markerDir, 'slow-ok-${i}.end'), String(Date.now()));`,
          `console.log('slow ok ${i}');`,
          `process.exit(0);`,
          '',
        ].join('\n'),
      );
    }

    const totalStubs = 3 + 1 + 1 + SLOW_OK_COUNT; // fast+skip+fail, timeout, bundle, slow-ok*N

    // Naive "if this ran fully sequential" lower-bound estimate, built only
    // from durations WE chose for the stubs (not measured) — the timeout
    // stub is capped at SEED_TIMEOUT either way, so it contributes the cap,
    // not its full sleep.
    const sequentialLowerBoundMs =
      SLOW_OK_COUNT * SLOW_OK_MS + SEED_TIMEOUT_SECONDS * 1000 + BUNDLE_SLEEP_MS;

    const result = await runSeeders(seedDir, markerDir);

    // --- every stub appears exactly once in the output ---
    const names = [
      'seed-fast-ok.mjs',
      'seed-skip-case.mjs',
      'seed-fail-case.mjs',
      'seed-timeout-case.mjs',
      'seed-bundle-test.mjs',
      ...Array.from({ length: SLOW_OK_COUNT }, (_, i) => `seed-slow-ok-${i}.mjs`),
    ];
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = result.stdout.match(new RegExp(`→ ${escaped} \\.\\.\\.`, 'g')) || [];
      assert.equal(matches.length, 1, `expected exactly one progress line for ${name}, got ${matches.length}\n---stdout---\n${result.stdout}`);
    }

    // --- per-stub classification ---
    assert.match(result.stdout, /→ seed-fast-ok\.mjs \.\.\. OK/);
    assert.match(result.stdout, /→ seed-skip-case\.mjs \.\.\. SKIP/);
    assert.match(result.stdout, /→ seed-fail-case\.mjs \.\.\. FAIL/);
    assert.match(result.stdout, /→ seed-timeout-case\.mjs \.\.\. TIMEOUT/);
    // The bundle exemption survived: it slept past SEED_TIMEOUT but is unwrapped -> OK.
    assert.match(result.stdout, /→ seed-bundle-test\.mjs \.\.\. OK/);
    for (let i = 0; i < SLOW_OK_COUNT; i += 1) {
      assert.match(result.stdout, new RegExp(`→ seed-slow-ok-${i}\\.mjs \\.\\.\\. OK`));
    }

    // --- final summary line: exact counts ---
    // ok = fast-ok + bundle-test + N slow-ok; skip = 1; fail = 1; timeout = 1.
    const expectedOk = 1 + 1 + SLOW_OK_COUNT;
    const summaryMatch = result.stdout.match(/Done: (\d+) ok, (\d+) skipped, (\d+) failed, (\d+) timed out/);
    assert.ok(summaryMatch, `expected a "Done: ..." summary line in stdout:\n${result.stdout}`);
    const [, okCount, skipCount, failCount, timeoutCount] = summaryMatch.map(Number);
    assert.equal(okCount, expectedOk, 'ok count');
    assert.equal(skipCount, 1, 'skip count');
    assert.equal(failCount, 1, 'fail count');
    assert.equal(timeoutCount, 1, 'timeout count');
    assert.equal(okCount + skipCount + failCount + timeoutCount, totalStubs, 'counts should sum to total stubs');

    // --- reconstruct overlap from the stubs' own start/end timestamps
    // (exact — no polling, so no race with how busy this process is) ---
    const { peakConcurrent, sawMoreThanOneAtOnce } = peakOverlapFromMarkers(markerDir, SLOW_OK_COUNT);

    // --- bounded: never more than CONCURRENCY slow-ok stubs running at once ---
    assert.ok(
      peakConcurrent <= CONCURRENCY,
      `peak concurrent slow-ok stubs (${peakConcurrent}) exceeded SEED_CONCURRENCY (${CONCURRENCY})`,
    );

    // --- genuinely concurrent: at some point more than one was running ---
    assert.ok(
      sawMoreThanOneAtOnce,
      'expected to observe more than one slow-ok stub running at the same time (concurrency was not actually happening)',
    );

    // --- wall-clock: a soft backstop against "no speedup at all", not the
    // primary proof of concurrency (the marker-based peakConcurrent /
    // sawMoreThanOneAtOnce assertions above already deterministically prove
    // that). This test spawns real child node processes and runs as one of
    // thousands of suites under the full test:data run's own
    // --test-concurrency=16, so on a CPU-constrained box (e.g. a 2-core
    // sandbox/CI runner) scheduling noise alone can eat 60%+ of the
    // sequential estimate even with genuine bounded concurrency happening —
    // a tight margin here turned into flaky failures unrelated to the
    // script's actual behavior. 90% still catches "concurrency is fully
    // broken" (which would land at ~100%+ of the sequential estimate, since
    // per-process overhead only adds on top of it). ---
    const threshold = sequentialLowerBoundMs * 0.9;
    assert.ok(
      result.elapsedMs < threshold,
      `expected parallel run (${result.elapsedMs}ms) to be under the sequential lower bound ` +
      `(${sequentialLowerBoundMs}ms, threshold ${threshold.toFixed(0)}ms) — concurrency does not appear to be happening`,
    );

    assert.equal(result.code, 0, `run-seeders.sh should exit 0; stderr:\n${result.stderr}`);
  } finally {
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(markerDir, { recursive: true, force: true });
  }
});

test('SEED_SCRIPT_DIR env var also selects the seeder directory (CLI arg omitted)', async () => {
  const seedDir = mkdtempSync(join(tmpdir(), 'run-seeders-stubs-env-'));
  const markerDir = mkdtempSync(join(tmpdir(), 'run-seeders-markers-env-'));
  try {
    writeFileSync(join(seedDir, 'seed-env-dir-ok.mjs'), `console.log('ok'); process.exit(0);\n`);

    const result = await new Promise((resolve, reject) => {
      const child = spawn('bash', [RUN_SEEDERS_SH], {
        env: {
          ...process.env,
          UPSTASH_REDIS_REST_TOKEN: 'test-token-not-real',
          UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:0',
          REDIS_TOKEN: '',
          SEED_TIMEOUT: '1',
          SEED_CONCURRENCY: '2',
          SEED_SCRIPT_DIR: seedDir,
          MARKER_DIR: markerDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (c) => { stdout += c; });
      child.on('close', (code) => resolve({ code, stdout }));
      child.on('error', reject);
    });

    assert.match(result.stdout, /→ seed-env-dir-ok\.mjs \.\.\. OK/);
    assert.match(result.stdout, /Done: 1 ok, 0 skipped, 0 failed, 0 timed out/);
    assert.equal(result.code, 0);
  } finally {
    rmSync(seedDir, { recursive: true, force: true });
    rmSync(markerDir, { recursive: true, force: true });
  }
});

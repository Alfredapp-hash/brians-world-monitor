#!/usr/bin/env bash
# Run all seed scripts against the local Redis REST proxy.
# Usage: ./scripts/run-seeders.sh [SEED_SCRIPT_DIR]
#
# Requires the worldmonitor stack to be running (uvx podman-compose up -d).
# The Redis REST proxy listens on localhost:8079 by default.
#
# Seeders run with BOUNDED CONCURRENCY (default 8 at a time, override with
# SEED_CONCURRENCY=<n>) instead of strictly one at a time. With 150+ seed
# scripts and a 40-minute CI job cap (.github/workflows/seed-data.yml),
# fully sequential execution risked the job timing out or starving later
# seeders of their share of the window.
#
# Requires bash 4.3+ (for `wait -n`, which frees a concurrency slot as soon
# as ANY running seeder finishes — not just the earliest-launched one. That
# distinction matters here: a single seeder that hangs up to its SEED_TIMEOUT
# cap must not stall the OTHER running slots for its full timeout, which a
# simpler "wait for the oldest job" pool would do). macOS ships bash 3.2 by
# default — install a newer one (e.g. `brew install bash`) if you hit the
# version check below.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: run-seeders.sh must be run under bash (needs 'wait -n' for bounded concurrency)." >&2
  echo "       Run it as ./scripts/run-seeders.sh or 'bash scripts/run-seeders.sh', not 'sh scripts/run-seeders.sh'." >&2
  exit 1
fi
bash_major="${BASH_VERSINFO[0]:-0}"
bash_minor="${BASH_VERSINFO[1]:-0}"
if [ "$bash_major" -lt 4 ] || { [ "$bash_major" -eq 4 ] && [ "$bash_minor" -lt 3 ]; }; then
  echo "ERROR: bash $BASH_VERSION is too old — run-seeders.sh needs bash 4.3+ for 'wait -n'." >&2
  echo "       macOS ships bash 3.2 by default; install a newer one (e.g. 'brew install bash')." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Directory to glob seed-*.mjs from. Defaults to this script's own directory
# (production use). Overridable via SEED_SCRIPT_DIR env var, or an optional
# first CLI arg (arg wins over the env var) — lets tests point this script
# at a directory of synthetic stub seeders without needing real Redis
# credentials or real upstream API calls. The .env / docker-compose.override
# sourcing below is UNCHANGED by this override: it always reads from this
# script's real PROJECT_DIR regardless of where seeders are being globbed
# from, since a test still needs *some* value in UPSTASH_REDIS_REST_TOKEN to
# pass the fail-loud check just below (a fake one is fine — stub seeders
# never call Redis).
SEEDER_DIR="${1:-${SEED_SCRIPT_DIR:-$SCRIPT_DIR}}"

# Load REDIS_TOKEN (and any seeder API keys present) from .env so the
# host-side seeders can talk to the REST proxy with the same bearer the
# compose stack is using. Defaults removed in #3804 — the seeders fail-loud
# if REDIS_TOKEN is not in the environment or .env.
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_DIR/.env"
  set +a
fi

UPSTASH_REDIS_REST_URL="${UPSTASH_REDIS_REST_URL:-http://localhost:8079}"
# This script targets the LOCAL Docker REST proxy, so REDIS_TOKEN always
# wins if set — even when UPSTASH_REDIS_REST_TOKEN also appears in .env
# (e.g. a contributor who also works on the Vercel/Upstash side and keeps
# the production token in the same file). Otherwise we'd silently send a
# Vercel-Upstash bearer to localhost:8079 and the proxy would 401 the
# request with no hint about why. Reviewer caught this on PR #3829.
if [ -n "${REDIS_TOKEN:-}" ]; then
  UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"
fi
if [ -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]; then
  echo "ERROR: REDIS_TOKEN (or UPSTASH_REDIS_REST_TOKEN) is required." >&2
  echo "       Generate with: openssl rand -hex 32, then add to .env" >&2
  echo "       See SELF_HOSTING.md → Required Environment Variables." >&2
  exit 1
fi
export UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN

# Source API keys from docker-compose.override.yml if present.
# These keys are configured for the container but seeders run on the host.
OVERRIDE="$PROJECT_DIR/docker-compose.override.yml"
if [ -f "$OVERRIDE" ]; then
  _env_tmp=$(mktemp)
  grep -E '^\s+[A-Z_]+:' "$OVERRIDE" \
    | grep -v '#' \
    | sed 's/^\s*//' \
    | sed 's/: */=/' \
    | sed "s/[\"']//g" \
    | grep -E '^(NASA_FIRMS|GROQ|AISSTREAM|FRED|FINNHUB|EIA|ACLED_ACCESS_TOKEN|ACLED_EMAIL|ACLED_PASSWORD|CLOUDFLARE|AVIATIONSTACK|OPENAQ_API_KEY|WAQI_API_KEY|OPENROUTER_API_KEY|LLM_API_URL|LLM_API_KEY|LLM_MODEL|OLLAMA_API_URL|OLLAMA_MODEL)' \
    | sed 's/^/export /' > "$_env_tmp"
  . "$_env_tmp"
  rm -f "$_env_tmp"
fi
# Per-seeder wall-clock cap for STANDALONE seeders. They run with bounded
# concurrency (see SEED_CONCURRENCY below), so a single upstream that hangs
# (e.g. a slow NOAA/NSIDC fetch that doesn't honour its own AbortSignal and
# keeps the node process alive for an hour) would otherwise occupy one of
# those concurrency slots indefinitely — under a wrapping systemd/cron job
# timeout it drops everything still queued when the job cap hits. Capping
# each seeder bounds that blast radius. Default 1800s (30min): above any
# standalone seeder's real runtime yet below the pathological hangs (60min+),
# so it kills only runaway runs.
# Override with SEED_TIMEOUT=<seconds>, or SEED_TIMEOUT=0 to disable.
#
# Bundle seeders (seed-bundle-*.mjs) are EXEMPT from this cap: scripts/_bundle-runner.mjs
# already hard-caps every section with its own wall-clock timer (SIGTERM→SIGKILL on
# the section's child PID — immune to the DNS-hang blind spot) and runs sections
# sequentially, so a bundle's *legitimate* total can exceed SEED_TIMEOUT (e.g.
# resilience-recovery's Import-HHI section alone budgets 30min). Wrapping a bundle in
# the outer cap would false-kill it mid-run and orphan the in-flight section child.
SEED_TIMEOUT="${SEED_TIMEOUT:-1800}"

# Resolve once whether the outer cap is usable (timeout(1) present and a positive
# numeric budget). Non-numeric/empty SEED_TIMEOUT → test errors → disabled (plain node).
if command -v timeout >/dev/null 2>&1 && [ "${SEED_TIMEOUT:-0}" -gt 0 ] 2>/dev/null; then
  timeout_enabled=true
else
  timeout_enabled=false
fi

# How many seeders run at once. Default 8 is comfortably below typical
# Upstash/upstream-API rate-limit cliffs (each seeder makes a handful of
# requests) while still meaningfully shrinking the sequential-sum wall clock
# for 150+ scripts inside the 40-minute CI job cap. Override with
# SEED_CONCURRENCY=<n>; any non-positive-integer value falls back to 8.
SEED_CONCURRENCY="${SEED_CONCURRENCY:-8}"
case "$SEED_CONCURRENCY" in
  ''|*[!0-9]*) SEED_CONCURRENCY=8 ;;
esac
[ "$SEED_CONCURRENCY" -ge 1 ] 2>/dev/null || SEED_CONCURRENCY=1

# Bundle seeders self-bound per section — never wrap them in the outer cap.
is_bundle() {
  case "$1" in
    *seed-bundle-*) return 0 ;;
    *) return 1 ;;
  esac
}

# Whether THIS seeder is wrapped by the outer timeout.
caps_seed() {
  [ "$timeout_enabled" = true ] && ! is_bundle "$1"
}

run_seed() {
  if caps_seed "$1"; then
    # -k: if it ignores SIGTERM, SIGKILL it 30s later so the run can move on.
    timeout -k 30 "$SEED_TIMEOUT" node "$1" 2>&1
  else
    node "$1" 2>&1
  fi
}

# Run a single seeder, print its progress line (same "→ name.mjs ... STATUS"
# format as the old sequential loop — lines from concurrent jobs may
# interleave with each other in the terminal, which is expected), and write
# its OK/SKIP/FAIL/TIMEOUT classification to $2 for the parent to aggregate
# once every job has finished. Runs inside a background subshell (invoked
# with `&` by the caller), so these variables are local to that subshell —
# no cross-job interference.
run_one() {
  f="$1"
  resultfile="$2"
  name="$(basename "$f")"
  output=$(run_seed "$f")
  rc=$?
  last=$(printf '%s\n' "$output" | tail -1)

  # timeout(1) exits 124 when it had to terminate the child, or 128+signal
  # (137 = SIGKILL after the -k grace) when SIGTERM was ignored. Only trust this
  # classification for seeders we actually wrapped (bundles run unwrapped).
  if caps_seed "$f" && { [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; }; then
    status=TIMEOUT
    line=$(printf "→ %s ... TIMEOUT (killed after %ss)" "$name" "$SEED_TIMEOUT")
  elif printf '%s' "$last" | grep -qi "skip\|not set\|missing.*key\|not found"; then
    status=SKIP
    line=$(printf "→ %s ... SKIP (%s)" "$name" "$last")
  elif [ "$rc" -eq 0 ]; then
    status=OK
    line=$(printf "→ %s ... OK" "$name")
  else
    status=FAIL
    line=$(printf "→ %s ... FAIL (%s)" "$name" "$last")
  fi

  # Emitted as one write() call so concurrent jobs' lines don't get spliced
  # together mid-line (each line is well under the kernel's atomic-write
  # threshold for a shared fd).
  printf '%s\n' "$line"
  printf '%s\n' "$status" > "$resultfile"
}

RESULT_DIR="$(mktemp -d)"
trap 'rm -rf "$RESULT_DIR"' EXIT

active=0
for f in "$SEEDER_DIR"/seed-*.mjs; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  run_one "$f" "$RESULT_DIR/$name.result" &
  active=$((active + 1))
  if [ "$active" -ge "$SEED_CONCURRENCY" ]; then
    # Frees up as soon as ANY running job finishes (not necessarily the one
    # just launched) — real streaming concurrency, not a fixed-size batch
    # barrier. See the file-header comment for why that distinction matters.
    wait -n
    active=$((active - 1))
  fi
done
# Drain whatever's still running after the last batch is dispatched.
wait

ok=0 fail=0 skip=0 timedout=0
for rf in "$RESULT_DIR"/*.result; do
  [ -e "$rf" ] || continue
  status=$(cat "$rf")
  case "$status" in
    OK) ok=$((ok + 1)) ;;
    SKIP) skip=$((skip + 1)) ;;
    FAIL) fail=$((fail + 1)) ;;
    TIMEOUT) timedout=$((timedout + 1)) ;;
  esac
done

echo ""
echo "Done: $ok ok, $skip skipped, $fail failed, $timedout timed out"

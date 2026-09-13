/**
 * Daily allowance for on-demand AI brief regeneration.
 *
 * What is and is not metered, precisely:
 *
 *   - NOT metered: the world brief itself. Every visitor, signed in or not,
 *     gets the server-synthesized brief plus the cached copy, always. There
 *     is no locked empty state anywhere in this feature.
 *   - Metered: asking us to burn fresh LLM tokens generating a *new* brief
 *     on demand. That is real money per run, so free gets a real allowance
 *     (FREE_BRIEFING_RUNS_PER_DAY) and Pro gets a bigger one.
 *   - Never metered: runs powered by the user's own provider key. Their key,
 *     their spend — counting those would be indefensible.
 *
 * Fails OPEN. If storage is unreadable we allow the run: a blocked
 * localStorage must never be the reason someone can't refresh their brief.
 * The server-side quota (server/_shared/direct-llm-quota.ts) is the real
 * cost ceiling; this module exists to make the limit legible and to offer
 * the upgrade at the moment it actually matters.
 *
 * Pure module with injected storage/clock so it runs under `tsx --test`.
 */

import {
  FREE_BRIEFING_RUNS_PER_DAY,
  PRO_BRIEFING_RUNS_PER_DAY,
} from '../config/support';

const STORAGE_KEY = 'wm-brief-runs';

export interface BriefingContext {
  /** Active paying subscriber. See services/supporter-status.ts. */
  supporter: boolean;
  /** At least one BYOK provider key stored locally. */
  ownKey: boolean;
}

export interface BriefingAllowance {
  /** True when nothing is counted (own key). */
  unlimited: boolean;
  cap: number;
  used: number;
  remaining: number;
  /** Epoch ms of the next UTC midnight, when the counter resets. */
  resetsAtMs: number;
  /** Which rule produced this allowance — drives the copy shown to the user. */
  tier: 'byok' | 'pro' | 'free';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let storage: StorageLike | null | undefined;

function getStorage(): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return storage;
}

/** Test seam. Pass null to simulate unavailable storage. */
export function __setBriefingStorageForTests(next: StorageLike | null): void {
  storage = next;
}

export function utcDayKey(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function nextUtcMidnightMs(now: Date): number {
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
}

function readUsed(now: Date): number {
  const store = getStorage();
  if (!store) return 0;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day?: unknown; count?: unknown };
    // A record from a previous UTC day is simply expired.
    if (parsed.day !== utcDayKey(now)) return 0;
    const count = Number(parsed.count);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch {
    return 0;
  }
}

function writeUsed(count: number, now: Date): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ day: utcDayKey(now), count }));
  } catch {
    // Best effort. Losing the counter errs toward letting the user work.
  }
}

export function capFor(ctx: BriefingContext): number {
  if (ctx.ownKey) return Number.POSITIVE_INFINITY;
  return ctx.supporter ? PRO_BRIEFING_RUNS_PER_DAY : FREE_BRIEFING_RUNS_PER_DAY;
}

export function getBriefingAllowance(
  ctx: BriefingContext,
  now: Date = new Date(),
): BriefingAllowance {
  const resetsAtMs = nextUtcMidnightMs(now);

  if (ctx.ownKey) {
    return {
      unlimited: true,
      cap: Number.POSITIVE_INFINITY,
      used: 0,
      remaining: Number.POSITIVE_INFINITY,
      resetsAtMs,
      tier: 'byok',
    };
  }

  const cap = capFor(ctx);
  const used = readUsed(now);
  return {
    unlimited: false,
    cap,
    used,
    remaining: Math.max(0, cap - used),
    resetsAtMs,
    tier: ctx.supporter ? 'pro' : 'free',
  };
}

export function canRunBriefing(ctx: BriefingContext, now: Date = new Date()): boolean {
  const allowance = getBriefingAllowance(ctx, now);
  return allowance.unlimited || allowance.remaining > 0;
}

/**
 * Record one hosted brief generation. Call AFTER a successful run so a failed
 * provider chain doesn't spend the user's allowance. Runs on a user-supplied
 * key are not counted.
 */
export function consumeBriefingRun(
  ctx: BriefingContext,
  now: Date = new Date(),
): BriefingAllowance {
  if (ctx.ownKey) return getBriefingAllowance(ctx, now);
  const used = readUsed(now) + 1;
  writeUsed(used, now);
  return getBriefingAllowance(ctx, now);
}

export function __resetBriefingAllowanceForTests(): void {
  const store = getStorage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

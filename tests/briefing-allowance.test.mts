// Tests for src/services/briefing-allowance.ts
//
// This module is the ONLY metered surface in the product: hosted LLM spend on
// on-demand brief regeneration. These tests pin the two promises that make
// that defensible — a user's own provider key is never counted, and a blocked
// localStorage never blocks a brief (fail open).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  FREE_BRIEFING_RUNS_PER_DAY,
  PRO_BRIEFING_RUNS_PER_DAY,
} from '../src/config/support.ts';
import {
  __setBriefingStorageForTests,
  canRunBriefing,
  capFor,
  consumeBriefingRun,
  getBriefingAllowance,
  nextUtcMidnightMs,
  utcDayKey,
  type BriefingContext,
} from '../src/services/briefing-allowance.ts';

interface FakeStorage {
  map: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function makeFakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const FREE: BriefingContext = { supporter: false, ownKey: false };
const PRO: BriefingContext = { supporter: true, ownKey: false };
const BYOK: BriefingContext = { supporter: false, ownKey: true };

let store: FakeStorage;

describe('briefing allowance', () => {
  beforeEach(() => {
    store = makeFakeStorage();
    __setBriefingStorageForTests(store);
  });

  describe('caps come from config, not magic numbers', () => {
    it('free cap is FREE_BRIEFING_RUNS_PER_DAY', () => {
      assert.equal(capFor(FREE), FREE_BRIEFING_RUNS_PER_DAY);
      assert.equal(getBriefingAllowance(FREE).cap, FREE_BRIEFING_RUNS_PER_DAY);
    });

    it('supporter cap is PRO_BRIEFING_RUNS_PER_DAY', () => {
      assert.equal(capFor(PRO), PRO_BRIEFING_RUNS_PER_DAY);
      assert.equal(getBriefingAllowance(PRO).cap, PRO_BRIEFING_RUNS_PER_DAY);
    });

    it('own key has no finite cap', () => {
      assert.equal(capFor(BYOK), Number.POSITIVE_INFINITY);
    });
  });

  describe('tier labelling', () => {
    it("reports 'free' for an anonymous/non-paying visitor", () => {
      assert.equal(getBriefingAllowance(FREE).tier, 'free');
    });

    it("reports 'pro' for an active supporter", () => {
      assert.equal(getBriefingAllowance(PRO).tier, 'pro');
    });

    it("reports 'byok' when a local provider key is present", () => {
      assert.equal(getBriefingAllowance(BYOK).tier, 'byok');
    });
  });

  describe('consumption', () => {
    it('increments used and decrements remaining', () => {
      const before = getBriefingAllowance(FREE);
      assert.equal(before.used, 0);
      assert.equal(before.remaining, FREE_BRIEFING_RUNS_PER_DAY);

      const after = consumeBriefingRun(FREE);
      assert.equal(after.used, 1);
      assert.equal(after.remaining, FREE_BRIEFING_RUNS_PER_DAY - 1);

      const again = consumeBriefingRun(FREE);
      assert.equal(again.used, 2);
      assert.equal(again.remaining, FREE_BRIEFING_RUNS_PER_DAY - 2);
    });

    it('blocks only after exactly `cap` runs', () => {
      for (let i = 0; i < FREE_BRIEFING_RUNS_PER_DAY - 1; i++) {
        consumeBriefingRun(FREE);
        assert.equal(canRunBriefing(FREE), true, `run ${i + 1} should still be allowed`);
      }
      const last = consumeBriefingRun(FREE);
      assert.equal(last.used, FREE_BRIEFING_RUNS_PER_DAY);
      assert.equal(last.remaining, 0);
      assert.equal(canRunBriefing(FREE), false);
    });

    it('never reports negative remaining when the counter overshoots', () => {
      for (let i = 0; i < FREE_BRIEFING_RUNS_PER_DAY + 5; i++) consumeBriefingRun(FREE);
      assert.equal(getBriefingAllowance(FREE).remaining, 0);
    });

    it('lifts the ceiling for a supporter — the cap genuinely differs', () => {
      // Burn the free allowance, then ask the same storage as a supporter.
      for (let i = 0; i < FREE_BRIEFING_RUNS_PER_DAY; i++) consumeBriefingRun(FREE);
      assert.equal(canRunBriefing(FREE), false);

      assert.equal(canRunBriefing(PRO), true);
      const pro = getBriefingAllowance(PRO);
      assert.equal(pro.used, FREE_BRIEFING_RUNS_PER_DAY);
      assert.equal(pro.remaining, PRO_BRIEFING_RUNS_PER_DAY - FREE_BRIEFING_RUNS_PER_DAY);
      assert.ok(pro.remaining > 0);
    });
  });

  describe('own key is never metered', () => {
    it('reports unlimited', () => {
      const allowance = getBriefingAllowance(BYOK);
      assert.equal(allowance.unlimited, true);
      assert.equal(allowance.tier, 'byok');
      assert.equal(allowance.cap, Number.POSITIVE_INFINITY);
      assert.equal(allowance.remaining, Number.POSITIVE_INFINITY);
      assert.equal(allowance.used, 0);
    });

    it('stays runnable after far more runs than any cap', () => {
      for (let i = 0; i < PRO_BRIEFING_RUNS_PER_DAY * 3; i++) {
        consumeBriefingRun(BYOK);
      }
      assert.equal(canRunBriefing(BYOK), true);
      assert.equal(getBriefingAllowance(BYOK).used, 0);
    });

    it('writes NOTHING to storage', () => {
      for (let i = 0; i < 25; i++) consumeBriefingRun(BYOK);
      assert.equal(store.map.size, 0, 'own-key runs must never touch the counter');
    });

    it('does not consume an existing free counter', () => {
      consumeBriefingRun(FREE);
      const snapshot = store.map.get('wm-brief-runs');
      consumeBriefingRun(BYOK);
      assert.equal(store.map.get('wm-brief-runs'), snapshot);
    });
  });

  describe('per-UTC-day reset', () => {
    it('yesterday\u2019s count does not carry into today', () => {
      const day1 = new Date('2026-03-04T12:00:00Z');
      const day2 = new Date('2026-03-05T00:00:01Z');

      consumeBriefingRun(FREE, day1);
      assert.equal(getBriefingAllowance(FREE, day1).used, 1);

      assert.equal(getBriefingAllowance(FREE, day2).used, 0);
      assert.equal(canRunBriefing(FREE, day2), true);
    });

    it('an exhausted day resets at the UTC boundary', () => {
      const day1 = new Date('2026-03-04T23:59:59Z');
      const day2 = new Date('2026-03-05T00:00:00Z');
      for (let i = 0; i < FREE_BRIEFING_RUNS_PER_DAY; i++) consumeBriefingRun(FREE, day1);
      assert.equal(canRunBriefing(FREE, day1), false);
      assert.equal(canRunBriefing(FREE, day2), true);
      assert.equal(getBriefingAllowance(FREE, day2).remaining, FREE_BRIEFING_RUNS_PER_DAY);
    });

    it('counts stay within the same UTC day across hours', () => {
      const morning = new Date('2026-03-04T00:30:00Z');
      const evening = new Date('2026-03-04T23:00:00Z');
      consumeBriefingRun(FREE, morning);
      consumeBriefingRun(FREE, evening);
      assert.equal(getBriefingAllowance(FREE, evening).used, 2);
    });
  });

  describe('utcDayKey', () => {
    it('zero-pads month and day', () => {
      assert.equal(utcDayKey(new Date('2026-01-05T00:00:00Z')), '2026-01-05');
      assert.equal(utcDayKey(new Date('2026-01-05T23:59:59Z')), '2026-01-05');
    });

    it('uses UTC, not local time', () => {
      // 2026-03-04T23:30Z is still the 4th in UTC regardless of the runner's TZ.
      assert.equal(utcDayKey(new Date('2026-03-04T23:30:00Z')), '2026-03-04');
      assert.equal(utcDayKey(new Date('2026-12-31T18:00:00Z')), '2026-12-31');
    });
  });

  describe('nextUtcMidnightMs', () => {
    it('returns the following UTC midnight', () => {
      const now = new Date('2026-03-04T12:00:00Z');
      assert.equal(nextUtcMidnightMs(now), Date.parse('2026-03-05T00:00:00Z'));
    });

    it('rolls the month and the year', () => {
      assert.equal(
        nextUtcMidnightMs(new Date('2026-01-31T09:00:00Z')),
        Date.parse('2026-02-01T00:00:00Z'),
      );
      assert.equal(
        nextUtcMidnightMs(new Date('2026-12-31T23:59:59Z')),
        Date.parse('2027-01-01T00:00:00Z'),
      );
    });

    it('is surfaced as resetsAtMs on the allowance', () => {
      const now = new Date('2026-03-04T12:00:00Z');
      assert.equal(getBriefingAllowance(FREE, now).resetsAtMs, nextUtcMidnightMs(now));
      assert.equal(getBriefingAllowance(BYOK, now).resetsAtMs, nextUtcMidnightMs(now));
    });
  });

  describe('fail open', () => {
    it('allows the run when storage is unavailable', () => {
      __setBriefingStorageForTests(null);
      assert.equal(canRunBriefing(FREE), true);
      const allowance = getBriefingAllowance(FREE);
      assert.equal(allowance.used, 0);
      assert.equal(allowance.remaining, FREE_BRIEFING_RUNS_PER_DAY);
    });

    it('never accumulates a count it cannot persist', () => {
      __setBriefingStorageForTests(null);
      for (let i = 0; i < FREE_BRIEFING_RUNS_PER_DAY * 2; i++) consumeBriefingRun(FREE);
      assert.equal(canRunBriefing(FREE), true, 'a blocked localStorage must never block a brief');
    });

    it('treats corrupt counter records as zero rather than throwing', () => {
      store.map.set('wm-brief-runs', '{not json');
      assert.equal(getBriefingAllowance(FREE).used, 0);
      assert.equal(canRunBriefing(FREE), true);
    });

    it('ignores a negative or non-numeric stored count', () => {
      const day = new Date('2026-03-04T12:00:00Z');
      store.map.set('wm-brief-runs', JSON.stringify({ day: utcDayKey(day), count: -5 }));
      assert.equal(getBriefingAllowance(FREE, day).used, 0);
      store.map.set('wm-brief-runs', JSON.stringify({ day: utcDayKey(day), count: 'lots' }));
      assert.equal(getBriefingAllowance(FREE, day).used, 0);
    });

    it('survives a storage implementation that throws', () => {
      __setBriefingStorageForTests({
        getItem() {
          throw new Error('SecurityError');
        },
        setItem() {
          throw new Error('QuotaExceededError');
        },
        removeItem() {
          throw new Error('SecurityError');
        },
      });
      assert.equal(canRunBriefing(FREE), true);
      assert.equal(consumeBriefingRun(FREE).used, 0);
    });
  });
});

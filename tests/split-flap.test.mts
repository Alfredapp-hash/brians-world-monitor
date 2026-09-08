import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FLAP_CHAR_MS,
  FLAP_MAX_TOTAL_MS,
  FLAP_STAGGER_MS,
  FLAP_TURN_RATIO,
  planSplitFlap,
  visibleGlyphs,
} from '../src/utils/split-flap.ts';

describe('planSplitFlap', () => {
  it('plans nothing when the text is unchanged', () => {
    const plan = planSplitFlap('LIVE · 4 LAYERS', 'LIVE · 4 LAYERS');
    assert.equal(plan.changedCount, 0);
    assert.deepEqual(plan.cells, []);
    assert.equal(plan.durationMs, 0);
    assert.equal(plan.firstChanged, -1);
  });

  it('flags only the columns that actually differ', () => {
    const plan = planSplitFlap('LIVE · 4 LAYERS', 'LIVE · 7 LAYERS');
    assert.equal(plan.changedCount, 1);
    assert.equal(plan.firstChanged, 7);
    assert.equal(plan.lastChanged, 7);
    assert.equal(plan.cells.filter((cell) => cell.changed).length, 1);
    assert.equal(plan.cells[7]?.from, '4');
    assert.equal(plan.cells[7]?.to, '7');
  });

  it('rebases the stagger on the first changed column so a stable head does not idle', () => {
    const plan = planSplitFlap('LIVE · 4 LAYERS', 'LIVE · 7 LAYERS');
    // The single changed column starts immediately despite sitting at index 7.
    assert.equal(plan.cells[7]?.delayMs, 0);
    // Untouched columns carry no delay because they never animate.
    assert.equal(plan.cells[0]?.delayMs, 0);
    assert.equal(plan.cells[0]?.changed, false);
  });

  it('staggers consecutive changed columns left to right', () => {
    const plan = planSplitFlap('AAAA', 'BBBB');
    const delays = plan.cells.map((cell) => cell.delayMs);
    assert.deepEqual(delays, [0, FLAP_STAGGER_MS, FLAP_STAGGER_MS * 2, FLAP_STAGGER_MS * 3]);
    for (let i = 1; i < delays.length; i += 1) {
      assert.ok(delays[i]! > delays[i - 1]!, 'delays must increase across columns');
    }
  });

  it('compresses the stagger so a long cascade fits the time budget', () => {
    const plan = planSplitFlap('A'.repeat(80), 'B'.repeat(80));
    assert.ok(plan.staggerMs < FLAP_STAGGER_MS, 'a long label must compress its stagger');
    assert.ok(
      plan.durationMs <= FLAP_MAX_TOTAL_MS,
      `cascade ran ${plan.durationMs}ms, over the ${FLAP_MAX_TOTAL_MS}ms budget`,
    );
  });

  it('reserves one column per index of the longer string', () => {
    assert.equal(planSplitFlap('SHORT', 'MUCH LONGER LABEL').cells.length, 17);
    assert.equal(planSplitFlap('MUCH LONGER LABEL', 'SHORT').cells.length, 17);
  });

  it('marks shrinking columns as vacating so they flap to a blank in place', () => {
    const plan = planSplitFlap('ABCDE', 'AB');
    const vacating = plan.cells.filter((cell) => cell.vacating);
    assert.equal(vacating.length, 3);
    assert.deepEqual(vacating.map((cell) => cell.index), [2, 3, 4]);
    // A vacating column keeps its old glyph as the outgoing face.
    assert.equal(plan.cells[2]?.from, 'C');
    assert.equal(plan.cells[2]?.to, '');
  });

  it('does not mark growing columns as vacating', () => {
    const plan = planSplitFlap('AB', 'ABCDE');
    assert.equal(plan.cells.filter((cell) => cell.vacating).length, 0);
  });

  it('is code-point safe for HUD separators and degree signs', () => {
    const plan = planSplitFlap('00.00°N', '34.05°N');
    // 7 code points, not 7 UTF-16 units by accident.
    assert.equal(plan.cells.length, 7);
    assert.equal(plan.cells[5]?.to, '°');
    assert.equal(plan.cells[5]?.changed, false);
  });

  it('handles empty strings in both directions', () => {
    assert.equal(planSplitFlap('', 'ABC').cells.length, 3);
    assert.equal(planSplitFlap('ABC', '').cells.length, 3);
    assert.equal(planSplitFlap('', '').changedCount, 0);
  });

  it('honours caller-supplied timings', () => {
    const plan = planSplitFlap('AA', 'BB', { charMs: 100, staggerMs: 50, maxTotalMs: 5000 });
    assert.equal(plan.staggerMs, 50);
    assert.equal(plan.durationMs, 150);
  });

  it('falls back to defaults for nonsense timings', () => {
    const plan = planSplitFlap('A', 'B', { charMs: -5, staggerMs: Number.NaN });
    assert.equal(plan.durationMs, FLAP_CHAR_MS);
  });
});

describe('visibleGlyphs', () => {
  it('shows the outgoing glyphs before any column has turned', () => {
    const plan = planSplitFlap('AAAA', 'BBBB');
    assert.equal(visibleGlyphs(plan, 0), 'AAAA');
  });

  it('shows the incoming glyphs once every column has turned', () => {
    const plan = planSplitFlap('AAAA', 'BBBB');
    assert.equal(visibleGlyphs(plan, 10_000), 'BBBB');
  });

  it('shows a mid-cascade mix that matches the stagger', () => {
    const plan = planSplitFlap('AAAA', 'BBBB');
    const turn = FLAP_CHAR_MS * FLAP_TURN_RATIO;
    // Just past column 1's crossover: columns 0 and 1 have turned, 2 and 3 not.
    const mixed = visibleGlyphs(plan, turn + FLAP_STAGGER_MS + 1);
    assert.equal(mixed, 'BBAA');
  });

  it('is always positionally true — one character per column', () => {
    const plan = planSplitFlap('ABCDE', 'XY');
    for (const elapsed of [0, 50, 100, 200, 400, 5000]) {
      assert.equal(
        visibleGlyphs(plan, elapsed).length,
        5,
        `column count drifted at ${elapsed}ms`,
      );
    }
  });

  it('renders a cleared column as a blank rather than closing it up', () => {
    const plan = planSplitFlap('ABCDE', 'AB');
    // After the turn the trailing columns are blanks, holding their places.
    assert.equal(visibleGlyphs(plan, 10_000), 'AB   ');
  });

  it('renders a not-yet-filled column as a blank while growing', () => {
    const plan = planSplitFlap('AB', 'ABCDE');
    assert.equal(visibleGlyphs(plan, 0), 'AB   ');
  });

  it('never shows a glyph that was never on screen after an interrupt', () => {
    // A → B is cut short by a C cascade. What C flaps away from must be what
    // the eye was actually reading, which mid-stagger is still partly A.
    const first = planSplitFlap('AAAA', 'BBBB');
    const turn = FLAP_CHAR_MS * FLAP_TURN_RATIO;
    const onScreen = visibleGlyphs(first, turn + FLAP_STAGGER_MS + 1);
    assert.equal(onScreen, 'BBAA');

    const second = planSplitFlap(onScreen, 'CCCC');
    for (const cell of second.cells) {
      assert.ok(
        cell.from === 'B' || cell.from === 'A',
        `interrupt flapped away from "${cell.from}", which was never displayed`,
      );
    }
  });

  it('treats a missing plan and bad elapsed values as empty rather than throwing', () => {
    assert.equal(visibleGlyphs(null, 100), '');
    assert.equal(visibleGlyphs(undefined, 100), '');
    const plan = planSplitFlap('AA', 'BB');
    assert.equal(visibleGlyphs(plan, Number.NaN), 'AA');
    assert.equal(visibleGlyphs(plan, -500), 'AA');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVERYDAY_ANALYST_PANELS,
  EVERYDAY_CORE_PANELS,
  EVERYDAY_MISSION_PRESET_ID,
  READER_MODE_KEY,
  READER_MODE_SEED_KEY,
  hasExplicitReaderModeChoice,
  isReaderMode,
  seedReaderModePreference,
} from '../src/services/reader-mode.ts';
import { formatCoverageSpinCue } from '../src/components/ReaderHero.ts';
import { summarizeCivilianCoverage } from '../src/services/reader-mode.ts';

describe('reader-mode helpers', () => {
  it('recognizes everyday and analyst modes only', () => {
    assert.equal(isReaderMode('everyday'), true);
    assert.equal(isReaderMode('analyst'), true);
    assert.equal(isReaderMode('something-else'), false);
    assert.equal(isReaderMode(null), false);
  });

  it('keeps everyday core and analyst disclose lists non-overlapping', () => {
    const core = new Set(EVERYDAY_CORE_PANELS);
    for (const id of EVERYDAY_ANALYST_PANELS) {
      assert.equal(core.has(id), false, `${id} should not be in everyday core`);
    }
    assert.ok(EVERYDAY_CORE_PANELS.includes('insights'));
    assert.ok(EVERYDAY_CORE_PANELS.includes('politics'));
    assert.equal(EVERYDAY_CORE_PANELS.length, 2);
    assert.equal(EVERYDAY_CORE_PANELS.includes('latest-brief'), false);
    assert.equal(EVERYDAY_CORE_PANELS.includes('live-news'), false);
    assert.equal(EVERYDAY_CORE_PANELS.includes('intel'), false);
    assert.ok(EVERYDAY_ANALYST_PANELS.includes('coverage-compare'));
    assert.ok(EVERYDAY_ANALYST_PANELS.includes('cii'));
    assert.equal(EVERYDAY_MISSION_PRESET_ID, 'everyday-reader');
  });

  it('seeds analyst for existing customized layouts (no FOUC to everyday)', () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    try {
      store.set('panel-order', '["insights"]');
      assert.equal(hasExplicitReaderModeChoice(), false);
      assert.equal(seedReaderModePreference(), 'analyst');
      assert.equal(store.get(READER_MODE_KEY), 'analyst');
      assert.equal(store.get(READER_MODE_SEED_KEY), '1');
      // Second call is a no-op once seeded.
      assert.equal(seedReaderModePreference(), 'analyst');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      });
    }
  });

  it('seeds everyday for fresh installs without layout history', () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    try {
      assert.equal(seedReaderModePreference(), 'everyday');
      assert.equal(store.get(READER_MODE_KEY), 'everyday');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
      });
    }
  });
});

describe('formatCoverageSpinCue', () => {
  it('uses lead outlet only — never peer-story bleed', () => {
    assert.match(formatCoverageSpinCue(7, 'Reuters') ?? '', /7 outlets.*Reuters/);
    assert.doesNotMatch(formatCoverageSpinCue(7, 'Reuters') ?? '', /AP|BBC/);
    assert.match(formatCoverageSpinCue(4, 'AP') ?? '', /Building coverage · AP/);
    assert.match(formatCoverageSpinCue(1, 'BBC') ?? '', /Thin coverage.*BBC/);
    assert.equal(formatCoverageSpinCue(0, 'X'), null);
  });
});

describe('summarizeCivilianCoverage', () => {
  const empty = { mainstream: [], independent: [], state: [], gov: [], local: [] };

  it('names covered vs quiet outlet classes in plain language', () => {
    const summary = summarizeCivilianCoverage({
      ...empty,
      mainstream: [{}, {}],
      independent: [{}],
    });
    assert.match(summary.covered, /mainstream wires \(2\)/);
    assert.match(summary.covered, /independent outlets/);
    assert.match(summary.ignored ?? '', /Quiet so far/);
    assert.match(summary.ignored ?? '', /local press/);
    assert.doesNotMatch(summary.covered, /NCI|Engineered Reality/);
    assert.doesNotMatch(summary.ignored ?? '', /NCI/);
  });

  it('surfaces framing cues without methodology jargon', () => {
    const talking = summarizeCivilianCoverage(
      { ...empty, mainstream: [{}], independent: [{}] },
      { talkingPoint: true },
    );
    assert.match(talking.framing ?? '', /same phrasing/i);
    assert.doesNotMatch(talking.framing ?? '', /NCI|sync %|talking-point alert/i);

    const silent = summarizeCivilianCoverage(
      { ...empty, independent: [{}, {}] },
      { asymmetry: 'mainstream-silent' },
    );
    assert.match(silent.framing ?? '', /Independent outlets are on this/i);
  });
});

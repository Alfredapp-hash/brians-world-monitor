/**
 * Guards the map layer picker's *user-facing* contract: plain-language groups,
 * plain-language row names, and the search aliases that make them findable.
 *
 * The picker is the only way a reader chooses what is on the map, and the
 * failures this file exists to catch are all silent — a layer quietly filed
 * under a group nobody reads, a rename that drops a translated locale back
 * into English, or a data layer with no searchable word attached to it. None
 * of those break a build.
 *
 * DOM behaviour (row re-housing, whole-row clicking, master toggles) is not
 * covered here: there is no DOM shim in this suite, so it is verified in the
 * browser instead.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  LAYER_GROUPS,
  OTHER_GROUP_ID,
  PLAIN_LAYER_LABELS,
  groupForLayer,
  plainLayerLabel,
} from '../src/components/map/layer-groups';
import {
  LAYER_REGISTRY,
  LAYER_SYNONYMS,
  getLayersForVariant,
  resolveLayerLabel,
} from '../src/config/map-layer-definitions';
import type { MapLayers } from '../src/types';

const registryKeys = Object.keys(LAYER_REGISTRY) as Array<keyof MapLayers>;

describe('layer picker groups', () => {
  test('every registry layer is claimed by exactly one group', () => {
    const seen = new Map<string, string[]>();
    for (const group of LAYER_GROUPS) {
      for (const key of group.layers) {
        const owners = seen.get(key) ?? [];
        owners.push(group.id);
        seen.set(key, owners);
      }
    }

    for (const [key, owners] of seen) {
      assert.equal(owners.length, 1, `${key} is in multiple groups: ${owners.join(', ')}`);
      assert.ok(LAYER_REGISTRY[key as keyof MapLayers], `${key} is grouped but not in LAYER_REGISTRY`);
    }

    const unclaimed = registryKeys.filter((key) => !seen.has(key));
    assert.deepEqual(
      unclaimed,
      [],
      `ungrouped layers would fall into "${OTHER_GROUP_ID}" instead of a named shelf`,
    );
  });

  test('group names are plain language, not desk names', () => {
    for (const group of LAYER_GROUPS) {
      assert.ok(group.label.length > 0, `${group.id} has no label`);
      // Sentence case: an all-caps or Title-Cased-Everything header is the
      // analyst voice this picker moved away from.
      assert.notEqual(group.label, group.label.toUpperCase(), `${group.id} label is shouting`);
    }
  });

  test('cameras and disease each get their own findable shelf', () => {
    assert.equal(groupForLayer('webcams').id, 'cameras');
    assert.match(groupForLayer('webcams').label, /camera/i);

    assert.equal(groupForLayer('diseaseOutbreaks').id, 'health');
    assert.match(groupForLayer('diseaseOutbreaks').label, /health|disease/i);
  });

  test('unknown keys fall back to the "other" shelf rather than vanishing', () => {
    const fallback = groupForLayer('notARealLayer' as keyof MapLayers);
    assert.equal(fallback.id, OTHER_GROUP_ID);
  });

  test('the fallback shelf is last so stragglers sort to the bottom', () => {
    assert.equal(LAYER_GROUPS[LAYER_GROUPS.length - 1]?.id, OTHER_GROUP_ID);
  });
});

describe('plain-language row labels', () => {
  test('renames only apply to the English label the engines actually render', () => {
    // `from` must match what resolveLayerLabel() produces with no translator,
    // otherwise the rename silently never fires.
    for (const [key, entry] of Object.entries(PLAIN_LAYER_LABELS)) {
      const def = LAYER_REGISTRY[key as keyof MapLayers];
      assert.ok(def, `${key} has a plain label but no registry entry`);
      assert.equal(
        entry.from.toLowerCase(),
        resolveLayerLabel(def).toLowerCase(),
        `${key}: plain-label \`from\` must match the rendered English label`,
      );
    }
  });

  test('a translated label is left alone', () => {
    // A reader on a non-English locale keeps their translation: the rename is
    // keyed on the English source string, not applied blindly.
    assert.equal(plainLayerLabel('webcams', 'Cámaras en vivo'), 'Cámaras en vivo');
    assert.equal(plainLayerLabel('ais', 'Schiffsverkehr'), 'Schiffsverkehr');
  });

  test('the analyst vocabulary becomes something a reader would say', () => {
    assert.equal(plainLayerLabel('webcams', 'Live Webcams'), 'Live cameras');
    assert.equal(plainLayerLabel('diseaseOutbreaks', 'Disease Outbreaks'), 'Disease outbreaks');
    assert.equal(plainLayerLabel('ais', 'Ship Traffic'), 'Ships');
    assert.equal(plainLayerLabel('ucdpEvents', 'Armed Conflict Events'), 'Battles & clashes');
    assert.equal(plainLayerLabel('natural', 'Natural Events'), 'Earthquakes & disasters');
    assert.equal(plainLayerLabel('ciiChoropleth', 'CII Instability'), 'Country instability');
  });

  test('no rename shouts, and none is an internal key', () => {
    for (const [key, entry] of Object.entries(PLAIN_LAYER_LABELS)) {
      assert.notEqual(entry.to, entry.to.toUpperCase(), `${key} renamed to an all-caps label`);
      assert.notEqual(entry.to, key, `${key} renamed to its own internal key`);
    }
  });

  test('layers with no rename pass through untouched', () => {
    assert.equal(plainLayerLabel('iranAttacks', 'Iran Attacks'), 'Iran Attacks');
  });
});

describe('layer search vocabulary', () => {
  const synonymTargets = new Set(Object.values(LAYER_SYNONYMS).flat());

  test('every synonym points at a real layer', () => {
    for (const [alias, keys] of Object.entries(LAYER_SYNONYMS)) {
      for (const key of keys) {
        assert.ok(LAYER_REGISTRY[key], `synonym "${alias}" points at unknown layer "${key}"`);
      }
    }
  });

  test('the words people type for outbreaks and cameras resolve', () => {
    for (const word of ['disease', 'outbreak', 'epidemic', 'health', 'virus', 'covid']) {
      assert.deepEqual(
        LAYER_SYNONYMS[word],
        ['diseaseOutbreaks'],
        `"${word}" must find the disease outbreak layer`,
      );
    }
    for (const word of ['camera', 'cameras', 'webcam', 'cctv', 'street']) {
      assert.ok(
        LAYER_SYNONYMS[word]?.includes('webcams'),
        `"${word}" must find the public webcam layer`,
      );
    }
  });

  test('every layer in the default variant is reachable by name or synonym', () => {
    // A layer whose plain name is not a searchable word (an acronym, a score)
    // needs a synonym, or a reader who does not already know the term cannot
    // filter down to it in a long list.
    const opaque = getLayersForVariant('full', 'flat')
      .filter((def) => {
        const plain = plainLayerLabel(def.key, resolveLayerLabel(def));
        // Names of two+ real words are self-describing enough to be typed.
        const wordy = plain.split(/[\s&/]+/).filter((w) => w.length > 3).length > 0;
        return !wordy && !synonymTargets.has(def.key);
      })
      .map((def) => def.key);
    assert.deepEqual(opaque, [], 'these layers have neither a searchable name nor a synonym');
  });
});

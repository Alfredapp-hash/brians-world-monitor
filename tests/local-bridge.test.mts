import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnchors, clusterAnchors, bridgeLocalCoverage } from '../src/utils/local-bridge';

describe('local-bridge', () => {
  it('extracts capitalized latin anchors, skipping furniture', () => {
    const anchors = extractAnchors('Breaking: Macron meets Scholz in Berlin over Ukraine aid');
    assert.ok(anchors.has('macron'));
    assert.ok(anchors.has('scholz'));
    assert.ok(anchors.has('berlin'));
    assert.ok(anchors.has('ukraine'));
    assert.ok(!anchors.has('breaking'));
  });

  it('maps Cyrillic aliases to canonical anchors', () => {
    const anchors = extractAnchors('Путин обсудил с Китаем поставки газа');
    assert.ok(anchors.has('putin'));
    // "Китаем" is an inflected form not in the table — only exact aliases map.
  });

  it('maps Arabic aliases to canonical anchors', () => {
    const anchors = extractAnchors('بوتين يزور الصين لبحث أوكرانيا');
    assert.ok(anchors.has('putin'));
    assert.ok(anchors.has('china'));
    assert.ok(anchors.has('ukraine'));
  });

  it('bridges a Russian headline into a matching English cluster via core alias', () => {
    const clusterTitles = [
      'Putin orders new offensive as Ukraine braces for winter',
      'Ukraine reports heavy fighting after Putin speech',
    ];
    const bridged = bridgeLocalCoverage(clusterTitles, [
      { source: 'Meduza', title: 'Путин объявил о новом наступлении', lang: 'ru' },
      { source: 'Aaj Tak', title: 'दिल्ली में भारी बारिश से यातायात प्रभावित', lang: 'hi' },
    ]);
    assert.equal(bridged.length, 1);
    assert.equal(bridged[0]!.source, 'Meduza');
  });

  it('bridges latin-script local coverage with 2+ shared anchors', () => {
    const clusterTitles = [
      'Macron and Scholz clash over Ukraine funding at summit',
      'Ukraine funding split dominates Macron summit agenda',
    ];
    const bridged = bridgeLocalCoverage(clusterTitles, [
      { source: 'Le Monde', title: 'Sommet: Macron défend le financement de l\'Ukraine', lang: 'fr' },
      { source: 'El País', title: 'La sequía golpea la agricultura andaluza', lang: 'es' },
    ]);
    assert.equal(bridged.length, 1);
    assert.equal(bridged[0]!.source, 'Le Monde');
  });

  it('does not bridge unrelated stories', () => {
    const clusterTitles = ['Fed holds interest rates steady amid inflation data'];
    const bridged = bridgeLocalCoverage(clusterTitles, [
      { source: 'Meduza', title: 'Путин посетил военный завод', lang: 'ru' },
    ]);
    assert.equal(bridged.length, 0);
  });

  it('computes core anchors from repeated mentions', () => {
    const { core, all } = clusterAnchors([
      'Putin visits Beijing for trade talks',
      'Putin arrives in China amid sanctions pressure',
      'Kremlin confirms Xi meeting',
    ]);
    assert.ok(core.has('putin'));
    assert.ok(all.has('kremlin'));
    assert.ok(!core.has('kremlin'));
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCountryDeepDivePanelHarness } from './helpers/country-deep-dive-panel-harness.mjs';

async function waitForResilienceWidget(harness: Awaited<ReturnType<typeof createCountryDeepDivePanelHarness>>): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (harness.getPanelRoot()?.querySelector('.resilience-widget-stub')) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const emptySignals = {
  criticalNews: 0,
  protests: 0,
  militaryFlights: 0,
  militaryVessels: 0,
  militaryFlightsInCountry: 0,
  militaryVesselsInCountry: 0,
  outages: 0,
  aisDisruptions: 0,
  satelliteFires: 0,
  radiationAnomalies: 0,
  temporalAnomalies: 0,
  cyberThreats: 0,
  earthquakes: 0,
  displacementOutflow: 0,
  climateStress: 0,
  conflictEvents: 0,
  activeStrikes: 0,
  orefSirens: 0,
  orefHistory24h: 0,
  aviationDisruptions: 0,
  travelAdvisories: 0,
  travelAdvisoryMaxLevel: null,
  gpsJammingHexes: 0,
  isTier1: true,
  thermalEscalations: 0,
  sanctionsDesignations: 0,
  sanctionsNewDesignations: 0,
};

test('country click brief includes a Rights section with the U.S. Bill of Rights', async () => {
  const harness = await createCountryDeepDivePanelHarness();
  try {
    const panel = harness.createPanel();
    panel.show('United States', 'US', null, emptySignals);
    await waitForResilienceWidget(harness);
    const card = harness.getPanelRoot()?.querySelector<HTMLElement>('.cdp-rights');
    assert.ok(card, 'country brief must include a Rights card');
    const text = card?.textContent ?? '';
    assert.match(text, /Bill of Rights/);
    assert.match(text, /Amendment I/);
    assert.match(text, /Foreigners|persons/i);
    assert.match(text, /Travel/i);
    const hrefs = [...(card?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href') || '');
    assert.ok(hrefs.some((h) => h.includes('archives.gov')), `U.S. rights card must link the National Archives, got ${hrefs.join(', ')}`);
    assert.ok(hrefs.some((h) => h.includes('osint4all')), 'rights card must link OSINT4ALL');
  } finally {
    harness.cleanup();
  }
});

test('unindexed country still gets a Rights card with constitution and travel links', async () => {
  const harness = await createCountryDeepDivePanelHarness();
  try {
    const panel = harness.createPanel();
    panel.show('Iceland', 'IS', null, emptySignals);
    await waitForResilienceWidget(harness);
    const card = harness.getPanelRoot()?.querySelector<HTMLElement>('.cdp-rights');
    assert.ok(card);
    assert.match(card?.textContent ?? '', /not yet indexed|constitution/i);
    const hrefs = [...(card?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href') || '');
    assert.ok(hrefs.some((h) => h.includes('constituteproject.org')), `expected constitute link, got ${hrefs.join(', ')}`);
    assert.ok(hrefs.some((h) => h.includes('travel.state.gov')), `expected State Dept link, got ${hrefs.join(', ')}`);
  } finally {
    harness.cleanup();
  }
});

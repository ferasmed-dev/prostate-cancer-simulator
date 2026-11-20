import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, runBoth, defaults, sanitize, ENTITIES, ENTITY, MODES, PRESETS, decision, prostate as P } from '../src/model.js';

const last = (a) => a[a.length - 1];
const has = (r, k) => r.events.some((e) => e.key === k);

test('three blocks, 9 entities, unique ids', () => {
  assert.equal(MODES.length, 3);
  assert.equal(ENTITIES.length, 9);
  assert.equal(new Set(ENTITIES.map((e) => e.id)).size, 9);
});

test('every entity runs both arms with finite, bounded series and a prostate schematic', () => {
  for (const ent of ENTITIES) for (const arm of ['untreated', 'treated']) {
    const r = run(ent, {}, arm);
    for (const sd of ent.series) for (const v of r.s[sd.key]) {
      assert.ok(Number.isFinite(v), `${ent.id}.${sd.key}`);
      if (sd.min !== undefined) assert.ok(v >= sd.min);
      if (sd.max !== undefined) assert.ok(v <= sd.max);
    }
    assert.equal(ent.schematic(last(r.states), r.p).kind, 'prostate');
  }
});

test('extreme parameter values stay finite', () => {
  for (const ent of ENTITIES) for (const edge of ['min', 'max']) {
    const params = {};
    for (const d of ent.params) {
      if (d.type === 'range') params[d.key] = d[edge];
      if (d.type === 'bool') params[d.key] = edge === 'max';
      if (d.type === 'select') params[d.key] = edge === 'min' ? d.options[0] : d.options[d.options.length - 1];
    }
    for (const arm of ['untreated', 'treated']) for (const [k, a] of Object.entries(run(ent, params, arm).s)) for (const v of a) assert.ok(Number.isFinite(v), `${ent.id}.${k} ${edge}`);
  }
});

test('runs are pure and deterministic; arms start identical', () => {
  for (const ent of ENTITIES) {
    const p = defaults(ent); const copy = JSON.stringify(p);
    const a = run(ent, p, 'treated');
    assert.deepEqual(a.s, run(ent, p, 'treated').s);
    assert.equal(JSON.stringify(p), copy);
    const u = run(ent, p, 'untreated');
    for (const k of Object.keys(u.s)) assert.equal(u.s[k][0], a.s[k][0], `${ent.id}.${k}`);
  }
});

test('sanitize clamps and rejects bad input; every entity gives a decision', () => {
  const p = sanitize(ENTITY.lowRisk, { psa0: 999, treatment: 'x' });
  assert.equal(p.psa0, 80); assert.equal(p.treatment, 'surveillance');
  for (const ent of ENTITIES) assert.equal(typeof decision(ent.id, run(ent, {}, 'treated').states.at(-1), defaults(ent)), 'string');
});

test('EAU risk groups', () => {
  assert.equal(P.riskGroup(6, 1, 'T1c'), 'low');
  assert.equal(P.riskGroup(7, 2, 'T2a'), 'favourableIntermediate');
  assert.equal(P.riskGroup(12, 2, 'T2a'), 'intermediate');
  assert.equal(P.riskGroup(8, 1, 'T2b'), 'intermediate');
  assert.equal(P.riskGroup(25, 1, 'T1c'), 'high');
  assert.equal(P.riskGroup(8, 4, 'T1c'), 'high');
  assert.equal(P.riskGroup(8, 2, 'T3b'), 'locallyAdvanced');
  assert.equal(P.riskGroup(8, 2, 'T3a'), 'locallyAdvanced');
  assert.equal(P.riskGroup(16, 4, 'T2c'), 'high');
});

test('PSA rises with gland and tumour volume; cT follows tumour volume', () => {
  assert.ok(P.psaOf(80, 0) > P.psaOf(30, 0));
  assert.ok(P.psaOf(40, 3) > P.psaOf(40, 1));
  assert.ok(Math.abs(P.volumeFromPsa(P.psaOf(40, 2, 2), 40, 2) - 2) < 1e-9);
  const order = [0.2, 1, 2, 4, 8, 15, 30].map(P.cT);
  assert.deepEqual(order, ['T1c', 'T2a', 'T2b', 'T2c', 'T3a', 'T3b', 'T4']);
});

test('higher grade grows and metastasises faster', () => {
  assert.ok(P.TD[5] < P.TD[1]);
  assert.ok(P.MET_K[5] > P.MET_K[1]);
});

test('life expectancy falls with age and comorbidity (≈ 19 years at 65)', () => {
  assert.ok(Math.abs(P.lifeExpectancy(65, false) - 19) < 2);
  assert.ok(P.lifeExpectancy(80, false) < 10);
  assert.ok(P.lifeExpectancy(70, true) < P.lifeExpectancy(70, false));
});

test('MRI changes the probability of significant cancer in the right direction', () => {
  const pr = P.pretest({ psa: 7, prostVol: 40, dre: false, age: 63, family: false });
  assert.ok(P.PIRADS_LR[5] > 1 && P.PIRADS_LR[2] < 1);
  assert.ok(P.pretest({ psa: 14, prostVol: 40, dre: true, age: 63, family: false }) > pr);
});

test('functional outcomes: prostatectomy costs continence early; nerve sparing preserves erections', () => {
  const ns = run(ENTITY.highRisk, { nerveSparing: true }, 'treated');
  const no = run(ENTITY.highRisk, { nerveSparing: false }, 'treated');
  assert.ok(Math.min(...ns.states.slice(0, 20).map((x) => x.continence)) < 60);
  assert.ok(ns.states.at(-1).erection > no.states.at(-1).erection);
});

test('treatment improves cancer-specific survival in intermediate and high risk', () => {
  for (const id of ['intermediateRisk', 'highRisk', 'locallyAdvanced']) {
    const b = runBoth(ENTITY[id], {});
    assert.ok(last(b.treated.s.css) > last(b.untreated.s.css) + 20, id);
  }
});

const EXPECT = {
  screeningAverage: (b) => has(b.treated, 'radicalTreatment') && has(b.untreated, 'clinicalDiagnosis') && last(b.treated.s.css) > last(b.untreated.s.css),
  screeningIndolent: (b) => !has(b.treated, 'radicalTreatment') && Math.abs(last(b.treated.s.css) - last(b.untreated.s.css)) < 0.5,
  screeningBrca2: (b) => has(b.treated, 'radicalTreatment') && last(b.untreated.s.css) < 70,
  screeningAggressive: (b) => last(b.untreated.s.css) < 40 && last(b.treated.s.css) > 85,
  pathwayPirads4: (b) => last(b.treated.s.detected) > last(b.untreated.s.detected) && last(b.treated.s.overdx) < last(b.untreated.s.overdx),
  pathwayPirads2: (b) => has(b.treated, 'biopsyAvoided') && last(b.treated.s.infection) === 0,
  pathwayPirads5Dre: (b) => last(b.treated.s.pPost) > 85,
  pathwayTransrectal: (b) => last(b.treated.s.infection) > 2,
  lowRiskSurveillance: (b) => has(b.treated, 'surveillance') && last(b.untreated.s.css) > 90,
  lowRiskProstatectomy: (b) => has(b.treated, 'surgery') && Math.abs(last(b.treated.s.os) - last(b.untreated.s.os)) < 5,
  lowRiskBrachy: (b) => has(b.treated, 'brachy') && !has(b.treated, 'brachyNotEligible'),
  lowRiskFocal: (b) => has(b.treated, 'focal') && !has(b.treated, 'focalNotEligible') && last(b.treated.s.psa) > last(run(ENTITY.lowRisk, { treatment: 'rp' }, 'treated').s.psa),
  lowRiskElderlyObservation: (b) => decision('lowRisk', b.treated.states[0], b.treated.p) === 'observation' && last(b.treated.s.os) < 5,
  intermediateProstatectomy: (b) => last(b.treated.s.css) > 95 && last(b.untreated.s.css) < 75,
  intermediateRadiotherapy: (b) => has(b.treated, 'adtWithRt') && last(b.treated.s.css) > 95,
  intermediateBrachyLargeGland: (b) => has(b.treated, 'brachyNotEligible') && has(b.treated, 'retentionRisk'),
  favourableIntermediateSurveillance: (b) => has(b.treated, 'reclassification'),
  highRiskProstatectomy: (b) => has(b.treated, 'lymphadenectomy') && has(b.treated, 'salvageRt'),
  highRiskRadiotherapyAdt: (b) => b.treated.events.find((e) => e.key === 'adtWithRt').vars.months === 30 && !has(b.treated, 'castrationResistance'),
  highRiskSurveillance: (b) => has(b.treated, 'surveillanceNotIndicated') && last(b.treated.s.css) < last(runBoth(ENTITY.highRisk, {}).treated.s.css),
  highRiskNoNerveSparing: (b) => b.treated.states.at(-1).erection < run(ENTITY.highRisk, {}, 'treated').states.at(-1).erection,
  locallyAdvancedEbrtAdt: (b) => last(b.treated.s.css) > last(b.untreated.s.css) + 40,
  locallyAdvancedMultimodal: (b) => has(b.treated, 'multimodal'),
  locallyAdvancedAdtAlone: (b) => has(b.treated, 'castrationResistance') && last(b.treated.s.css) < last(runBoth(ENTITY.locallyAdvanced, {}).treated.s.css),
  bcrEarlySalvage: (b) => has(b.treated, 'salvageRt') && last(b.treated.s.css) > 95 && last(b.untreated.s.css) < 60,
  bcrLateSalvage: (b) => last(b.treated.s.pM) > last(runBoth(ENTITY.bcr, {}).treated.s.pM),
  bcrFastDoubling: (b) => decision('bcr', b.treated.states[0], b.treated.p) === 'highRiskBcr' && last(b.treated.s.pM) > 50,
  bcrEarlyAdt: (b) => has(b.treated, 'earlyAdt') && has(b.treated, 'castrationResistance'),
  mhspcHighVolumeArpi: (b) => has(b.treated, 'castrate') && last(b.treated.s.survival) > last(runBoth(ENTITY.mhspc, { treatment: 'adt' }).treated.s.survival),
  mhspcAdtAlone: (b) => { const e = b.treated.events.find((x) => x.key === 'crpc'); return e && e.t >= 18 && e.t <= 24; },
  mhspcTriplet: (b) => last(b.treated.s.survival) > last(runBoth(ENTITY.mhspc, {}).treated.s.survival),
  mhspcLowVolumeDocetaxel: (b) => has(b.treated, 'docetaxelLowVolume'),
  mcrpcArpiNaive: (b) => has(b.treated, 'psa50') && last(b.treated.s.survival) > last(b.untreated.s.survival),
  mcrpcArpiAfterArpi: (b) => has(b.treated, 'crossResistance'),
  mcrpcOlaparibBrca: (b) => last(b.treated.s.survival) > last(b.untreated.s.survival) + 5,
  mcrpcOlaparibNoMutation: (b) => has(b.treated, 'hrrNeeded') && Math.abs(last(b.treated.s.survival) - last(b.untreated.s.survival)) < 0.01,
  mcrpcLuPsma: (b) => !has(b.treated, 'luPsmaCriteria') && last(b.treated.s.survival) > last(b.untreated.s.survival) + 5,
  mcrpcDocetaxel: (b) => has(b.treated, 'psa50'),
};

test('every preset is valid and behaves as documented', () => {
  assert.deepEqual(Object.keys(EXPECT).sort(), Object.keys(PRESETS).sort());
  for (const [k, pr] of Object.entries(PRESETS)) {
    const ent = ENTITY[pr.entity];
    const p = sanitize(ent, pr.params);
    for (const [pk, v] of Object.entries(pr.params)) assert.equal(p[pk], v, `${k}.${pk}`);
    assert.ok(EXPECT[k](runBoth(ent, pr.params)), k);
  }
});

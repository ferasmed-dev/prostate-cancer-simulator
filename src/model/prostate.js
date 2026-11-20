// Prostate cancer: early detection, the MRI–biopsy pathway, localised disease by risk group, biochemical
// recurrence, metastatic hormone-sensitive and castration-resistant disease. Pure functions only.
import { clamp, relax } from './core.js';
import { ageHazard, hazardFromProb, weibullHazard } from './onco.js';

// ---------------------------------------------------------------------------
// Shared tumour biology (Model)
// ---------------------------------------------------------------------------
/** Tumour volume doubling time (years) by ISUP grade group. */
export const TD = { 1: 5, 2: 3.5, 3: 2.5, 4: 1.6, 5: 1.0 };
/** Annual hazard of metastasis per cc of tumour, by ISUP grade group. */
export const MET_K = { 1: 0.00015, 2: 0.0008, 3: 0.0022, 4: 0.006, 5: 0.012 };
/** PSA produced per cc of cancer (ng/mL): ≈ 3.5 (Stamey), less in poorly differentiated ISUP 5 tumours. */
export const psaPerCc = (isup) => (isup >= 5 ? 2.5 : 3.5);
/** Serum PSA (ng/mL): benign gland ≈ 0.066 ng/mL per mL of prostate + tumour contribution. */
export const psaOf = (prostVol, V, isup = 2) => 0.066 * prostVol + V * psaPerCc(isup);
/** Tumour volume implied by a PSA value. */
export const volumeFromPsa = (psa, prostVol, isup = 2) => Math.max(0.05, (psa - 0.066 * prostVol) / psaPerCc(isup));
/** Logistic tumour growth towards a 40 cc ceiling (Model). */
export const grow = (V, k, dt) => V * Math.exp(k * (1 - V / 40) * dt);
/** Clinical T category from tumour volume (Model mapping onto TNM 8). */
export function cT(V) {
  if (V < 0.5) return 'T1c';
  if (V < 1.5) return 'T2a';
  if (V < 3) return 'T2b';
  if (V < 6) return 'T2c';
  if (V < 12) return 'T3a';
  if (V < 25) return 'T3b';
  return 'T4';
}
const T_RANK = { T1c: 0, T2a: 1, T2b: 2, T2c: 3, T3a: 4, T3b: 5, T4: 6 };
/** EAU risk group: low, intermediate (favourable if ISUP 2 with PSA < 10 and cT ≤ T2a), high, locally advanced (cT3–4). */
export function riskGroup(psa, isup, t) {
  const r = T_RANK[t];
  if (r >= 4) return 'locallyAdvanced';
  if (psa > 20 || isup >= 4 || r >= 3) return 'high';
  if (psa >= 10 || isup >= 2 || r === 2) return psa < 10 && isup === 2 && r <= 1 ? 'favourableIntermediate' : 'intermediate';
  return 'low';
}
/** Remaining life expectancy (years) from the same Gompertz other-cause hazard used in the survival curves. */
export function lifeExpectancy(age, comorbid) {
  let S = 1; let e = 0;
  for (let t = 0; t < 50; t += 0.25) { e += S * 0.25; S *= Math.exp(-ageHazard(age + t, comorbid) * 0.25); }
  return e;
}
/** Probability of a positive surgical margin by stage (Model, from radical prostatectomy series). */
export const MARGIN = { T1c: 0.12, T2a: 0.15, T2b: 0.18, T2c: 0.22, T3a: 0.35, T3b: 0.5, T4: 0.6 };
/** Baseline erectile function (% of men with erections adequate for intercourse) by age (Model). */
export const baselineErection = (age) => clamp(95 - 1.1 * (age - 50), 30, 95);

// ---------------------------------------------------------------------------
// Localised and locally advanced disease (one factory, four risk scenarios)
// ---------------------------------------------------------------------------
const TX_AT = 0.25; // years
function localEntity(id, def, options) {
  return {
    id, mode: 'local', unit: 'y', tMax: 20, dt: 0.05, view: 'prostate',
    params: [
      { key: 'psa0', type: 'range', min: 1, max: 80, step: 0.5, def: def.psa0, unit: 'ng/mL' },
      { key: 'isup', type: 'range', min: 1, max: 5, step: 1, def: def.isup, unit: '' },
      { key: 'prostVol', type: 'range', min: 20, max: 100, step: 5, def: 40, unit: 'mL' },
      { key: 'age', type: 'range', min: 45, max: 85, step: 1, def: def.age ?? 65, unit: 'y' },
      { key: 'comorbid', type: 'bool', def: false },
      { key: 'ipss', type: 'range', min: 0, max: 35, step: 1, def: 8, unit: '' },
      { key: 'nerveSparing', type: 'bool', def: def.nerveSparing ?? true },
      { key: 'salvage', type: 'bool', def: true },
      { key: 'treatment', type: 'select', options, def: options[0] },
    ],
    series: [
      { key: 'psa', unit: 'ng/mL', min: 0 },
      { key: 'pM', unit: '%', min: 0, max: 100 },
      { key: 'css', unit: '%', min: 0, max: 100 },
      { key: 'os', unit: '%', min: 0, max: 100 },
    ],
    init(p) {
      const V = volumeFromPsa(p.psa0, p.prostVol, p.isup);
      const e0 = baselineErection(p.age);
      return { psa: p.psa0, V, V0: V, benign: 1, pM: 0, Sc: 1, S: 1, removed: false, rt: false, kind: null, adtUntil: -1, testo: 450, continence: 98, erection: e0, e0, nadir: null, bcr: false, salvaged: false, surv: false, onAdt: false, crpc: false, stage: cT(V), tTx: null };
    },
    step(st, t, dt, p, arm, emit) {
      const k = Math.LN2 / TD[p.isup];
      if (arm === 'treated' && st.tTx === null && t >= TX_AT) {
        st.tTx = t;
        const risk = riskGroup(p.psa0, p.isup, cT(st.V0));
        if (lifeExpectancy(p.age, p.comorbid) < 10 && !['observation', 'surveillance'].includes(p.treatment)) emit('lowLifeExpectancy');
        switch (p.treatment) {
          case 'surveillance':
            st.surv = true; emit('surveillance');
            if (p.isup >= 3 || risk === 'high' || risk === 'locallyAdvanced') emit('surveillanceNotIndicated');
            break;
          case 'observation': st.watch = true; emit('observation'); break;
          case 'focal': {
            const ok = p.isup <= 2 && p.psa0 < 20 && p.prostVol <= 40;
            if (!ok) emit('focalNotEligible');
            st.V *= ok ? 0.15 : 0.4; st.kind = 'focal'; st.benign = 0.7; st.erection *= 0.9; emit('focal'); break;
          }
          case 'rp': case 'rpMultimodal': {
            const m = MARGIN[cT(st.V)];
            st.margin = m; st.Vrp = st.V;
            st.V = st.V * m * 0.015 * (p.treatment === 'rpMultimodal' ? 0.4 : 1);
            st.removed = true; st.benign = 0; st.kind = 'rp'; st.S *= 0.998;
            st.continence = 40; st.erection = 15;
            emit('surgery', { margin: Math.round(m * 100) });
            if (T_RANK[cT(st.Vrp)] >= 3 || p.isup >= 3) emit('lymphadenectomy');
            if (p.treatment === 'rpMultimodal') { st.adtUntil = t + 2; emit('multimodal'); }
            break;
          }
          case 'ebrt': case 'ebrtAdt': {
            const adtYears = p.treatment === 'ebrtAdt' || risk === 'high' || risk === 'locallyAdvanced' ? 2.5 : risk === 'intermediate' ? 0.5 : 0;
            const control = { low: 0.95, favourableIntermediate: 0.93, intermediate: 0.9, high: 0.8, locallyAdvanced: 0.7 }[risk];
            st.V *= (1 - control) * 0.3; st.rt = true; st.kind = 'ebrt'; st.benignTarget = 0.15;
            if (adtYears > 0) { st.adtUntil = t + adtYears; emit('adtWithRt', { months: Math.round(adtYears * 12) }); }
            emit('ebrt'); break;
          }
          case 'brachy': {
            const ok = p.prostVol < 50 && p.ipss < 12 && p.isup <= 2;
            if (!ok) emit('brachyNotEligible');
            st.V *= ok ? 0.07 * 0.3 : 0.25; st.rt = true; st.kind = 'brachy'; st.benignTarget = 0.1;
            emit('brachy');
            if (p.ipss >= 12 || p.prostVol >= 50) emit('retentionRisk');
            break;
          }
          case 'adtAlone': st.adtUntil = 999; st.kind = 'adt'; emit('adtAlone'); break;
          default: break;
        }
      }
      // active surveillance: PSA every 6 months, biopsy every year; reclassification → radical prostatectomy
      if (st.surv && !st.removed && t > TX_AT && Math.abs((t - TX_AT) % 1) < dt / 2) {
        if (st.V > 2 * st.V0 || T_RANK[cT(st.V)] >= T_RANK.T2c) {
          emit('reclassification');
          const m = MARGIN[cT(st.V)]; st.Vrp = st.V; st.V = st.V * m * 0.015; st.removed = true; st.benign = 0; st.kind = 'rp'; st.continence = 40; st.erection = 15; st.surv = false;
        }
      }
      // androgen deprivation: castrate testosterone, tumour regression, then castration resistance after ≈ 2 years
      const adt = t < st.adtUntil || st.onAdt;
      st.testo = relax(st.testo, adt ? 20 : 450, dt, 0.08);
      if (adt && !st.adtStart) { st.adtStart = t; }
      if (!adt) st.adtStart = null;
      const resist = adt && (st.onAdt || st.kind === 'adt') && st.adtStart !== null && t - st.adtStart > 2;
      if (resist && !st.crpc) { st.crpc = true; emit('castrationResistance'); }
      let g = k;
      if (adt && !resist) g = k - (Math.LN2 / 0.5);
      if (st.rt && t - st.tTx < 1.5) g -= 1.2; // radiation cell kill tapering over 18 months (Model)
      st.V = clamp(g === k ? grow(st.V, k, dt) : st.V * Math.exp(g * dt), 0.0005, 40);
      // salvage radiotherapy at PSA > 0.2 after prostatectomy
      const psaBenign = 0.066 * p.prostVol * st.benign;
      if (st.benignTarget !== undefined) st.benign = relax(st.benign, st.benignTarget, dt, 0.8);
      st.psa = (psaBenign + st.V * psaPerCc(p.isup)) * (adt && !resist ? 0.03 : 1);
      if (st.kind === 'rp' && !st.bcr && st.psa > 0.2) { st.bcr = true; emit('bcr'); if (p.salvage && arm === 'treated') { st.V *= 0.15; st.salvaged = true; st.continence -= 4; st.erection *= 0.85; emit('salvageRt'); } }
      if (st.rt) { st.nadir = st.nadir === null ? st.psa : Math.min(st.nadir, st.psa); if (!st.bcr && t - st.tTx > 1 && st.psa > st.nadir + 2) { st.bcr = true; emit('bcrPhoenix'); } }
      // metastasis and death
      st.pM += MET_K[p.isup] * st.V * (1 - st.pM) * dt;
      // palliative ADT once metastatic (observation and untreated metastatic disease differ in this)
      if (arm === 'treated' && st.pM > 0.5 && !st.onAdt && !(t < st.adtUntil)) { st.onAdt = true; st.adtStart = t; emit('palliativeAdt'); }
      const hMet = st.pM * (st.onAdt || adt ? 0.15 : 0.35);
      st.Sc *= Math.exp(-hMet * dt);
      st.S *= Math.exp(-(hMet + ageHazard(p.age + t, p.comorbid)) * dt);
      // functional outcomes
      if (st.kind === 'rp') { st.continence = relax(st.continence, st.salvaged ? 86 : 90, dt, 0.35); st.erection = relax(st.erection, st.e0 * (p.nerveSparing ? 0.6 : 0.25) * (st.salvaged ? 0.85 : 1), dt, 0.7); }
      if (st.kind === 'ebrt') { st.continence = relax(st.continence, 96, dt, 1); st.erection = relax(st.erection, st.e0 * 0.6 * (adt ? 0.3 : 1), dt, 1.5); }
      if (st.kind === 'brachy') { st.continence = relax(st.continence, 95, dt, 1); if (t - st.tTx > 3) st.erection = relax(st.erection, st.e0 * 0.6, dt, 1.5); }
      if (st.kind === 'adt' || adt) st.erection = relax(st.erection, st.e0 * 0.15, dt, 0.3);
      if (!st.kind) st.erection = relax(st.erection, baselineErection(p.age + t), dt, 2);
      if (st.kind === 'rp' && t - st.tTx > 1 && st.continence < 92) emit('incontinence');
      if (!st.removed && !st.kind) { const stg = cT(st.V); if (stg !== st.stage) { st.stage = stg; emit('stage', { s: stg }, false); } }
      if (st.pM > 0.1) emit('pM10');
      return st;
    },
    steps(st, p) {
      const k = ['peripheral'];
      const tc = cT(st.removed ? st.Vrp ?? st.V : st.V);
      if (!st.removed) k.push(T_RANK[tc] >= 4 ? 'extracapsular' : 'confined');
      if (st.surv) k.push('surveillance');
      if (st.kind === 'rp') k.push('rp');
      if (st.kind === 'ebrt' || st.kind === 'brachy') k.push('radiation');
      if (st.kind === 'focal') k.push('focal');
      if (st.testo < 50) k.push('castrate');
      if (st.bcr) k.push('bcr');
      if (st.pM > 0.05) k.push('metRisk');
      if (st.crpc) k.push('crpc');
      return k;
    },
    get: { pM: (st) => st.pM * 100, css: (st) => st.Sc * 100, os: (st) => st.S * 100 },
    gauges(st, p) {
      return [
        { key: 'lifeExp', value: lifeExpectancy(p.age, p.comorbid), unit: 'y', lo: 10, hi: 40 },
        { key: 'volume', value: st.removed ? 0 : st.V, unit: 'mL', lo: 0, hi: 0, band: false },
        { key: 'continence', value: st.continence, unit: '%', lo: 90, hi: 100 },
        { key: 'erection', value: st.erection, unit: '%', lo: 50, hi: 100 },
        { key: 'testo', value: st.testo, unit: 'ng/dL', lo: 300, hi: 1000 },
      ];
    },
    decision(st, p) {
      if (lifeExpectancy(p.age, p.comorbid) < 10) return 'observation';
      return riskGroup(p.psa0, p.isup, cT(st.V0));
    },
    schematic(st, p) {
      return { kind: 'prostate', V: st.removed ? st.V : st.V, removed: st.removed, stage: st.removed ? null : cT(st.V), psa: st.psa, rt: st.kind === 'ebrt', brachy: st.kind === 'brachy', focal: st.kind === 'focal', surveillance: st.surv, adt: st.testo < 50, mets: st.pM, nodes: st.pM > 0.2, testo: st.testo };
    },
  };
}
export const lowRisk = localEntity('lowRisk', { psa0: 6, isup: 1, age: 62 }, ['surveillance', 'rp', 'ebrt', 'brachy', 'focal', 'observation']);
export const intermediateRisk = localEntity('intermediateRisk', { psa0: 12, isup: 2, age: 64 }, ['rp', 'ebrt', 'brachy', 'surveillance', 'focal', 'observation']);
export const highRisk = localEntity('highRisk', { psa0: 16, isup: 4, age: 66 }, ['rp', 'ebrt', 'surveillance', 'observation']);
export const locallyAdvanced = localEntity('locallyAdvanced', { psa0: 60, isup: 4, age: 68, nerveSparing: false }, ['ebrtAdt', 'rpMultimodal', 'adtAlone', 'observation']);

// ---------------------------------------------------------------------------
// Early detection: an occult cancer followed with or without PSA testing (years)
// ---------------------------------------------------------------------------
/** Relative risk of prostate cancer by family history and BRCA2 (as taught: 1.8, 5.5, 7.7; BRCA2 ×8.6). */
export const FAMILY_RR = { none: 1, firstDegree: 1.8, fatherAndBrother: 5.5, twoBrothers: 7.7 };
export const earlyDetection = {
  id: 'earlyDetection', mode: 'dx', unit: 'y', tMax: 20, dt: 0.05, view: 'prostate',
  params: [
    { key: 'age', type: 'range', min: 45, max: 75, step: 1, def: 55, unit: 'y' },
    { key: 'family', type: 'select', options: Object.keys(FAMILY_RR), def: 'none' },
    { key: 'brca2', type: 'bool', def: false },
    { key: 'african', type: 'bool', def: false },
    { key: 'isup', type: 'range', min: 1, max: 5, step: 1, def: 3, unit: '' },
    { key: 'interval', type: 'range', min: 1, max: 4, step: 1, def: 2, unit: 'y' },
    { key: 'prostVol', type: 'range', min: 20, max: 80, step: 5, def: 35, unit: 'mL' },
  ],
  series: [
    { key: 'psa', unit: 'ng/mL', min: 0 },
    { key: 'V', unit: 'mL', min: 0 },
    { key: 'pM', unit: '%', min: 0, max: 100 },
    { key: 'css', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { V: 0.05, pM: 0, Sc: 1, detected: false, how: null, treated: false, as: false, removed: false, onAdt: false, psa: psaOf(p.prostVol, 0.05, p.isup), nextTest: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const isup = Math.min(5, p.isup + (p.brca2 ? 1 : 0));
    const k = Math.LN2 / TD[isup];
    const vol = p.prostVol * (1 + 0.015 * t); // benign growth with age
    if (!st.removed) st.V = st.onAdt ? Math.max(0.01, st.V * Math.exp((k - Math.LN2 / 0.5) * dt)) : grow(st.V, k, dt);
    st.psa = st.removed ? st.V * psaPerCc(isup) : psaOf(vol, st.V, isup) * (st.onAdt ? 0.05 : 1);
    // screening: PSA → (≥ 3 ng/mL, confirmed) MRI → biopsy → treatment by grade
    if (arm === 'treated' && !st.detected && t >= st.nextTest) {
      st.nextTest = t + p.interval;
      emit('psaTest', {}, false);
      if (st.psa >= 3) {
        // MRI shows clinically significant tumours ≥ 0.5 cc; low-grade tumours only when large (Model)
        const visible = isup >= 2 ? st.V >= 0.5 : st.V >= 1.5;
        emit(visible ? 'mriPositive' : 'mriNegative');
        if (visible) {
          st.detected = true; st.how = 'screen';
          if (isup === 1) { st.as = true; emit('overdiagnosis'); } else { const stage = cT(st.V); st.removed = true; st.V *= MARGIN[stage] * 0.015; emit('radicalTreatment', { stage }); }
        }
      }
    }
    // without screening (and after a missed one) cancer is found when it causes symptoms: locally advanced or metastatic
    if (!st.detected && (st.V >= 8 || st.pM > 0.2)) {
      st.detected = true; st.how = 'clinical'; emit('clinicalDiagnosis');
      if (st.pM > 0.2) { st.onAdt = true; emit('metastaticAtDiagnosis'); } else { st.removed = true; st.V *= 0.3; emit('lateRadical'); }
    }
    if (st.removed && st.pM > 0.5 && !st.onAdt) { st.onAdt = true; emit('palliativeAdt'); }
    st.pM += MET_K[isup] * st.V * (1 - st.pM) * dt;
    st.Sc *= Math.exp(-st.pM * (st.onAdt ? 0.15 : 0.35) * dt);
    if (st.pM > 0.1) emit('pM10');
    return st;
  },
  steps(st, p) {
    const k = ['occult'];
    if (st.psa > 3) k.push('psaRises');
    if (st.how === 'screen') k.push('screenDetected');
    if (st.as) k.push('overdiagnosis');
    if (st.how === 'clinical') k.push('lateDiagnosis');
    if (st.pM > 0.05) k.push('metRisk');
    return k;
  },
  get: { V: (st) => (st.removed ? 0 : st.V), pM: (st) => st.pM * 100, css: (st) => st.Sc * 100 },
  gauges(st, p) {
    const rr = FAMILY_RR[p.family] * (p.brca2 ? 8.6 : 1) * (p.african ? 1.6 : 1);
    return [{ key: 'lifetimeRisk', value: Math.min(80, 12 * rr), unit: '%', lo: 0, hi: 12 }, { key: 'psaNow', value: st.psa, unit: 'ng/mL', lo: 0, hi: 3 }];
  },
  decision(st, p) { return p.brca2 ? 'startAt40' : p.family !== 'none' || p.african ? 'startAt45' : 'startAt50'; },
  schematic(st, p) { return { kind: 'prostate', V: st.V, removed: st.removed, stage: st.removed ? null : cT(st.V), psa: st.psa, adt: st.onAdt, mets: st.pM, surveillance: st.as }; },
};

// ---------------------------------------------------------------------------
// The diagnostic pathway: PSA → confirmation → MRI (PI-RADS) → biopsy (weeks)
// ---------------------------------------------------------------------------
/** Likelihood ratio for clinically significant cancer by PI-RADS category (Model, from MRI-pathway series). */
export const PIRADS_LR = { 1: 0.05, 2: 0.1, 3: 0.4, 4: 1.9, 5: 7 };
const logit = (p) => Math.log(p / (1 - p));
const expit = (x) => 1 / (1 + Math.exp(-x));
/** Pre-test probability of clinically significant cancer from PSA density, DRE, age and family history (Model). */
export const pretest = (p) => expit(-2.2 + 5.5 * (p.psa / p.prostVol) + (p.dre ? 1 : 0) + 0.03 * (p.age - 63) + (p.family ? 0.4 : 0));
export const pathway = {
  id: 'pathway', mode: 'dx', unit: 'w', tMax: 12, dt: 0.25, view: 'prostate',
  params: [
    { key: 'psa', type: 'range', min: 2, max: 30, step: 0.5, def: 7, unit: 'ng/mL' },
    { key: 'prostVol', type: 'range', min: 20, max: 120, step: 5, def: 40, unit: 'mL' },
    { key: 'dre', type: 'bool', def: false },
    { key: 'age', type: 'range', min: 45, max: 80, step: 1, def: 63, unit: 'y' },
    { key: 'family', type: 'bool', def: false },
    { key: 'pirads', type: 'select', options: ['1', '2', '3', '4', '5'], def: '4' },
    { key: 'route', type: 'select', options: ['transperineal', 'transrectal'], def: 'transperineal' },
  ],
  series: [
    { key: 'pPost', unit: '%', min: 0, max: 100 },
    { key: 'detected', unit: '%', min: 0, max: 100 },
    { key: 'overdx', unit: '%', min: 0, max: 100 },
    { key: 'infection', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { p: pretest(p), pPost: pretest(p), detected: 0, overdx: 0, infection: 0, mri: false, biopsy: null }; },
  step(st, t, dt, p, arm, emit) {
    if (t >= 4) emit('psaConfirmed');
    if (arm === 'treated' && t >= 6 && !st.mri) {
      st.mri = true;
      st.pPost = expit(logit(st.p) + Math.log(PIRADS_LR[p.pirads]));
      emit('mri', { pirads: p.pirads });
    }
    if (t >= 8 && st.biopsy === null) {
      const psad = p.psa / p.prostVol;
      const doBiopsy = arm === 'untreated' || Number(p.pirads) >= 3 || psad >= 0.2;
      st.biopsy = doBiopsy;
      if (doBiopsy) {
        const sens = arm === 'untreated' ? 0.7 : Number(p.pirads) >= 3 ? 0.92 : 0.7;
        st.detected = st.pPost * sens;
        st.overdx = (1 - st.pPost) * (arm === 'untreated' ? 0.2 : 0.08);
        st.infection = p.route === 'transrectal' ? 0.03 : 0.005;
        emit(arm === 'untreated' ? 'systematicBiopsy' : 'targetedBiopsy');
        if (p.route === 'transrectal') emit('transrectalRisk');
      } else { emit('biopsyAvoided'); }
    }
    return st;
  },
  steps(st, p, arm) {
    const k = ['psa'];
    if (st.mri) k.push('mri');
    if (st.biopsy) k.push('biopsy');
    if (st.biopsy === false) k.push('avoided');
    return k;
  },
  get: { pPost: (st) => st.pPost * 100, detected: (st) => st.detected * 100, overdx: (st) => st.overdx * 100, infection: (st) => st.infection * 100 },
  gauges(st, p) { return [{ key: 'psad', value: p.psa / p.prostVol, unit: 'ng/mL²', lo: 0, hi: 0.15 }, { key: 'missed', value: Math.max(0, st.pPost - st.detected) * 100 * (st.biopsy === null ? 0 : 1), unit: '%', lo: 0, hi: 0, band: false }]; },
  decision(st, p) { return Number(p.pirads) <= 2 ? (p.psa / p.prostVol >= 0.2 ? 'biopsyDensity' : 'noBiopsy') : 'targeted'; },
  schematic(st, p, arm) { return { kind: 'prostate', V: 1.2, lesion: st.mri ? Number(p.pirads) : null, cores: st.biopsy ? (st.mri ? 'targeted' : 'systematic') : null, route: p.route, psa: p.psa, hideTumour: !st.mri }; },
};

// ---------------------------------------------------------------------------
// Biochemical recurrence after radical prostatectomy (years)
// ---------------------------------------------------------------------------
export const bcr = {
  id: 'bcr', mode: 'advanced', unit: 'y', tMax: 10, dt: 0.05, view: 'prostate',
  params: [
    { key: 'psa0', type: 'range', min: 0.2, max: 2, step: 0.1, def: 0.3, unit: 'ng/mL' },
    { key: 'psaDt', type: 'range', min: 3, max: 36, step: 1, def: 10, unit: 'mo' },
    { key: 'isup', type: 'range', min: 1, max: 5, step: 1, def: 3, unit: '' },
    { key: 'age', type: 'range', min: 50, max: 85, step: 1, def: 66, unit: 'y' },
    { key: 'treatment', type: 'select', options: ['salvageRt', 'salvageRtAdt', 'earlyAdt'], def: 'salvageRt' },
  ],
  series: [
    { key: 'psa', unit: 'ng/mL', min: 0 },
    { key: 'pM', unit: '%', min: 0, max: 100 },
    { key: 'css', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { V: p.psa0 / 2, pM: 0, Sc: 1, done: false, adt: false, adtStart: null, crpc: false, psa: p.psa0 }; },
  step(st, t, dt, p, arm, emit) {
    const k = Math.LN2 / (p.psaDt / 12);
    if (arm === 'treated' && !st.done && t >= 0.25) {
      st.done = true;
      const psa = st.V * 2;
      let control = psa < 0.5 ? 0.7 : psa < 1 ? 0.55 : 0.4;
      if (p.psaDt < 6) control *= 0.8;
      if (p.treatment === 'salvageRt' || p.treatment === 'salvageRtAdt') {
        if (p.treatment === 'salvageRtAdt') { control = Math.min(0.9, control + 0.1); st.adtUntil = t + 0.5; }
        st.V *= (1 - control) * 0.1; st.rt = true; emit('salvageRt', { psa: psa.toFixed(2) });
      } else { st.adt = true; st.adtStart = t; emit('earlyAdt'); }
    }
    const adt = st.adt || (st.adtUntil && t < st.adtUntil);
    const resist = st.adt && t - st.adtStart > 3;
    if (resist && !st.crpc) { st.crpc = true; emit('castrationResistance'); }
    let g = k;
    if (adt && !resist) g = k - Math.LN2 / 0.4;
    if (st.rt && t < 1.5) g -= 1.0;
    st.V = clamp(st.V * Math.exp(g * dt), 0.0005, 60);
    st.psa = st.V * 2 * (adt && !resist ? 0.05 : 1);
    st.pM += MET_K[p.isup] * 2.5 * st.V * (1 - st.pM) * dt;
    st.Sc *= Math.exp(-st.pM * (st.adt || arm === 'treated' ? 0.15 : 0.3) * dt);
    if (st.pM > 0.1) emit('pM10');
    if (st.psa > 2) emit('psa2');
    return st;
  },
  steps(st, p) {
    const k = ['residual'];
    if (st.rt) k.push('salvage');
    if (st.adt) k.push('adt');
    if (st.crpc) k.push('crpc');
    if (st.pM > 0.05) k.push('metRisk');
    return k;
  },
  get: { pM: (st) => st.pM * 100, css: (st) => st.Sc * 100 },
  gauges(st, p) { return [{ key: 'psaDt', value: p.psaDt, unit: 'mo', lo: 12, hi: 120 }]; },
  decision(st, p) { return p.psaDt < 12 || p.isup >= 4 ? 'highRiskBcr' : 'lowRiskBcr'; },
  schematic(st, p) { return { kind: 'prostate', V: st.V, removed: true, psa: st.psa, rt: !!st.rt, adt: st.adt || (st.adtUntil && st.adtUntil > 0 && st.psa < 0.1), mets: st.pM }; },
};

// ---------------------------------------------------------------------------
// Metastatic hormone-sensitive prostate cancer (months)
// ---------------------------------------------------------------------------
/** Median overall survival with ADT alone (CHAARTED: high volume ≈ 34, low volume ≈ 63 months); untreated: Model. */
export const MHSPC_MEDIAN = { untreated: { high: 18, low: 30 }, adt: { high: 34, low: 63 } };
/** Hazard ratio vs ADT alone (ARPI trials ≈ 0.65; docetaxel CHAARTED high volume 0.63, no benefit in low volume; triplet ARASENS/PEACE-1 ≈ 0.68 vs docetaxel). */
export const MHSPC_HR = { adt: { high: 1, low: 1 }, adtArpi: { high: 0.65, low: 0.65 }, adtDocetaxel: { high: 0.63, low: 1 }, triplet: { high: 0.43, low: 0.6 } };
/** Median time to castration resistance (months): ADT 18–24 as taught; with intensification longer (Model). */
export const CRPC_TIME = { adt: 20, adtArpi: 45, adtDocetaxel: 30, triplet: 55 };
export const mhspc = {
  id: 'mhspc', mode: 'advanced', unit: 'mo', tMax: 72, dt: 0.25, view: 'prostate',
  params: [
    { key: 'volume', type: 'select', options: ['high', 'low'], def: 'high' },
    { key: 'psa0', type: 'range', min: 10, max: 500, step: 10, def: 120, unit: 'ng/mL' },
    { key: 'treatment', type: 'select', options: ['adtArpi', 'triplet', 'adtDocetaxel', 'adt'], def: 'adtArpi' },
  ],
  series: [
    { key: 'psa', unit: 'ng/mL', min: 0 },
    { key: 'survival', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { psa: p.psa0, B: 100, S: 1, on: false, testo: 450, crpc: false, nadir: p.psa0 }; },
  step(st, t, dt, p, arm, emit) {
    const on = arm === 'treated' && t >= 0.5;
    if (on && !st.on) { st.on = true; st.t0 = t; emit('adt'); if (p.treatment !== 'adt') emit(p.treatment); if (p.treatment === 'adtDocetaxel' && p.volume === 'low') emit('docetaxelLowVolume'); }
    st.testo = relax(st.testo, on ? 20 : 450, dt, 0.5);
    if (on && st.testo < 50) emit('castrate');
    const g = Math.LN2 / (p.volume === 'high' ? 2.5 : 5);
    let kill = 0;
    if (on) {
      const s = t - st.t0; const tc = CRPC_TIME[p.treatment];
      if (s < tc) kill = g + Math.LN2 / 1.2 * Math.exp(-s / 6) + 0.02; else { kill = 0; if (!st.crpc) { st.crpc = true; emit('crpc'); } }
    }
    st.B = clamp(st.B * Math.exp((g - kill) * dt), 0.5, 3000);
    st.psa = p.psa0 * st.B / 100;
    st.nadir = Math.min(st.nadir, st.psa);
    if (on && st.psa < 0.2) emit('psaUndetectable');
    const median = on ? MHSPC_MEDIAN.adt[p.volume] : MHSPC_MEDIAN.untreated[p.volume];
    const hr = on ? MHSPC_HR[p.treatment][p.volume] : 1;
    st.S *= Math.exp(-weibullHazard(t + 0.5, median, 1.3) * hr * dt);
    st.medianNow = median * Math.pow(hr, -1 / 1.3);
    return st;
  },
  steps(st, p) {
    const k = ['androgenDriven'];
    if (st.on) k.push('castration');
    if (st.on && p.treatment !== 'adt') k.push('intensified');
    if (st.crpc) k.push('crpc');
    return k;
  },
  get: { survival: (st) => st.S * 100 },
  gauges(st, p) { return [{ key: 'testo', value: st.testo, unit: 'ng/dL', lo: 0, hi: 50 }, { key: 'medianOS', value: st.medianNow ?? MHSPC_MEDIAN.untreated[p.volume], unit: 'mo', lo: 0, hi: 0, band: false }]; },
  decision(st, p) { return p.treatment === 'adt' ? 'intensify' : p.treatment === 'adtDocetaxel' && p.volume === 'low' ? 'docetaxelLowVolume' : 'intensified'; },
  schematic(st, p) { return { kind: 'prostate', V: 14, stage: 'M1', psa: st.psa, adt: st.testo < 50, mets: clamp(st.B / 120, 0.1, 1), metsFixed: true, nodes: true, testo: st.testo }; },
};

// ---------------------------------------------------------------------------
// Metastatic castration-resistant prostate cancer (months)
// ---------------------------------------------------------------------------
/** HR vs continuing ADT alone (TAX327, PREVAIL/COU-AA-302, PROfound, VISION, TROPIC). */
export const MCRPC_HR = { docetaxel: 0.76, arpi: 0.7, arpiAfterArpi: 0.95, olaparib: 0.69, luPsma: 0.62, cabazitaxel: 0.7 };
export const mcrpc = {
  id: 'mcrpc', mode: 'advanced', unit: 'mo', tMax: 48, dt: 0.25, view: 'prostate',
  params: [
    { key: 'priorArpi', type: 'bool', def: false },
    { key: 'priorDocetaxel', type: 'bool', def: false },
    { key: 'hrr', type: 'bool', def: false },
    { key: 'psma', type: 'bool', def: true },
    { key: 'treatment', type: 'select', options: ['arpi', 'docetaxel', 'olaparib', 'luPsma', 'cabazitaxel'], def: 'arpi' },
  ],
  series: [
    { key: 'psa', unit: 'ng/mL', min: 0 },
    { key: 'survival', unit: '%', min: 0, max: 100 },
  ],
  init() { return { B: 100, S: 1, on: false, hr: 1, eff: 0, psa: 30 }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.on && t >= 0.5) {
      st.on = true; st.t0 = t;
      let hr = MCRPC_HR[p.treatment]; let eff = 1;
      if (p.treatment === 'arpi' && p.priorArpi) { hr = MCRPC_HR.arpiAfterArpi; eff = 0.2; emit('crossResistance'); }
      if (p.treatment === 'olaparib' && !p.hrr) { hr = 1; eff = 0; emit('hrrNeeded'); }
      if (p.treatment === 'luPsma' && (!p.psma || !p.priorArpi || !p.priorDocetaxel)) { if (!p.psma) { hr = 1; eff = 0; } emit('luPsmaCriteria'); }
      if (p.treatment === 'cabazitaxel' && !p.priorDocetaxel) emit('cabazitaxelAfterDocetaxel');
      st.hr = hr; st.eff = eff; emit('start', { tx: p.treatment });
    }
    const g = Math.LN2 / 2.5;
    const kill = st.on ? st.eff * (g + Math.LN2 / 2 * Math.exp(-(t - st.t0) / 5)) * (t - st.t0 < 10 ? 1 : 0.4) : 0;
    st.B = clamp(st.B * Math.exp((g - kill) * dt), 1, 4000);
    st.psa = 30 * st.B / 100;
    if (st.on && st.B < 50) emit('psa50');
    st.S *= Math.exp(-weibullHazard(t + 0.5, 15, 1.2) * (st.on ? st.hr : 1) * dt);
    st.medianNow = 15 * Math.pow(st.on ? st.hr : 1, -1 / 1.2);
    return st;
  },
  steps(st, p) { const k = ['castrationResistant']; if (st.on) k.push(p.treatment === 'olaparib' ? 'parp' : p.treatment === 'luPsma' ? 'radioligand' : p.treatment === 'arpi' ? 'arAxis' : 'taxane'); return k; },
  get: { survival: (st) => st.S * 100 },
  gauges(st) { return [{ key: 'medianOS', value: st.medianNow ?? 15, unit: 'mo', lo: 0, hi: 0, band: false }]; },
  decision(st, p) {
    if (p.hrr) return 'olaparib';
    if (p.priorArpi && p.priorDocetaxel) return p.psma ? 'luPsma' : 'cabazitaxel';
    if (p.priorArpi) return 'docetaxel';
    return 'arpi';
  },
  schematic(st) { return { kind: 'prostate', V: 16, stage: 'M1', psa: st.psa, adt: true, mets: clamp(st.B / 150, 0.15, 1), metsFixed: true, nodes: true, testo: 20 }; },
};

export const DX = [earlyDetection, pathway];
export const LOCAL = [lowRisk, intermediateRisk, highRisk, locallyAdvanced];
export const ADVANCED = [bcr, mhspc, mcrpc];

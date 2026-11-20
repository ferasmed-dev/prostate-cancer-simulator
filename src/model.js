// Public model API: entities by block, presets, key decisions and "Model" tags. Pure (no DOM).
export * from './model/core.js';
export * as onco from './model/onco.js';
export * as prostate from './model/prostate.js';
import { DX, LOCAL, ADVANCED } from './model/prostate.js';

export const MODES = [
  { id: 'dx', entities: DX },
  { id: 'local', entities: LOCAL },
  { id: 'advanced', entities: ADVANCED },
];
export const ENTITIES = MODES.flatMap((m) => m.entities);
export const ENTITY = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));
export const modeOf = (id) => ENTITY[id]?.mode;
export const stageLabel = (v) => String(v);

/** Teaching presets; each has a deep link ?preset=<key>. Expected behaviour is checked in tests/model.test.js. */
export const PRESETS = {
  // Early detection and diagnosis
  screeningAverage: { entity: 'earlyDetection', params: {} },
  screeningIndolent: { entity: 'earlyDetection', params: { isup: 1 } },
  screeningBrca2: { entity: 'earlyDetection', params: { age: 45, brca2: true, family: 'firstDegree' } },
  screeningAggressive: { entity: 'earlyDetection', params: { isup: 5, interval: 4 } },
  pathwayPirads4: { entity: 'pathway', params: {} },
  pathwayPirads2: { entity: 'pathway', params: { pirads: '2', psa: 5.5, prostVol: 55 } },
  pathwayPirads5Dre: { entity: 'pathway', params: { pirads: '5', psa: 12, dre: true } },
  pathwayTransrectal: { entity: 'pathway', params: { route: 'transrectal' } },
  // Localised and locally advanced
  lowRiskSurveillance: { entity: 'lowRisk', params: {} },
  lowRiskProstatectomy: { entity: 'lowRisk', params: { treatment: 'rp' } },
  lowRiskBrachy: { entity: 'lowRisk', params: { treatment: 'brachy' } },
  lowRiskFocal: { entity: 'lowRisk', params: { treatment: 'focal' } },
  lowRiskElderlyObservation: { entity: 'lowRisk', params: { age: 82, comorbid: true, treatment: 'observation' } },
  intermediateProstatectomy: { entity: 'intermediateRisk', params: {} },
  intermediateRadiotherapy: { entity: 'intermediateRisk', params: { treatment: 'ebrt' } },
  intermediateBrachyLargeGland: { entity: 'intermediateRisk', params: { treatment: 'brachy', prostVol: 70, ipss: 18 } },
  favourableIntermediateSurveillance: { entity: 'intermediateRisk', params: { psa0: 7, treatment: 'surveillance' } },
  highRiskProstatectomy: { entity: 'highRisk', params: {} },
  highRiskRadiotherapyAdt: { entity: 'highRisk', params: { treatment: 'ebrt' } },
  highRiskSurveillance: { entity: 'highRisk', params: { treatment: 'surveillance' } },
  highRiskNoNerveSparing: { entity: 'highRisk', params: { nerveSparing: false } },
  locallyAdvancedEbrtAdt: { entity: 'locallyAdvanced', params: {} },
  locallyAdvancedMultimodal: { entity: 'locallyAdvanced', params: { treatment: 'rpMultimodal', age: 60 } },
  locallyAdvancedAdtAlone: { entity: 'locallyAdvanced', params: { treatment: 'adtAlone' } },
  // Advanced disease
  bcrEarlySalvage: { entity: 'bcr', params: {} },
  bcrLateSalvage: { entity: 'bcr', params: { psa0: 1.5 } },
  bcrFastDoubling: { entity: 'bcr', params: { psaDt: 4, isup: 4, treatment: 'salvageRtAdt' } },
  bcrEarlyAdt: { entity: 'bcr', params: { treatment: 'earlyAdt' } },
  mhspcHighVolumeArpi: { entity: 'mhspc', params: {} },
  mhspcAdtAlone: { entity: 'mhspc', params: { treatment: 'adt' } },
  mhspcTriplet: { entity: 'mhspc', params: { treatment: 'triplet' } },
  mhspcLowVolumeDocetaxel: { entity: 'mhspc', params: { volume: 'low', treatment: 'adtDocetaxel', psa0: 40 } },
  mcrpcArpiNaive: { entity: 'mcrpc', params: {} },
  mcrpcArpiAfterArpi: { entity: 'mcrpc', params: { priorArpi: true } },
  mcrpcOlaparibBrca: { entity: 'mcrpc', params: { priorArpi: true, hrr: true, treatment: 'olaparib' } },
  mcrpcOlaparibNoMutation: { entity: 'mcrpc', params: { priorArpi: true, treatment: 'olaparib' } },
  mcrpcLuPsma: { entity: 'mcrpc', params: { priorArpi: true, priorDocetaxel: true, treatment: 'luPsma' } },
  mcrpcDocetaxel: { entity: 'mcrpc', params: { priorArpi: true, treatment: 'docetaxel' } },
};

export function decision(id, st, p) { return ENTITY[id]?.decision ? ENTITY[id].decision(st, p) : null; }

/** Parameters/series that are simulator tuning choices or proxies ("Modelo" / "Model" tag in the UI). */
export const MODEL_TAGS = {
  earlyDetection: ['V', 'pM'], pathway: ['pPost', 'detected', 'overdx'], lowRisk: ['pM', 'volume'], intermediateRisk: ['pM', 'volume'],
  highRisk: ['pM', 'volume'], locallyAdvanced: ['pM', 'volume'], bcr: ['pM'], mhspc: [], mcrpc: [],
};
export const isModelTagged = (id, key) => (MODEL_TAGS[id] || []).includes(key);

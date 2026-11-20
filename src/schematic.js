// Hand-drawn SVG schematic: the prostate in axial section (anterior up, rectum below) with its zones,
// the tumour, local extension, treatments and a distant-spread panel. Pure rendering from a plain
// description produced by the model.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const f1 = (x) => x.toFixed(1);
const RANK = { T1c: 0, T2a: 1, T2b: 2, T2c: 3, T3a: 4, T3b: 5, T4: 6 };

const CX = 168; const CY = 146; // gland centre
/** Chestnut-shaped gland outline: wider anteriorly-laterally, flattened posteriorly against the rectum. */
function glandPath(s = 1) {
  const p = (x, y) => `${f1(CX + x * s)} ${f1(CY + y * s)}`;
  return `M${p(0, -88)} C${p(70, -90)} ${p(118, -48)} ${p(118, 4)} C${p(118, 52)} ${p(80, 80)} ${p(0, 78)} C${p(-80, 80)} ${p(-118, 52)} ${p(-118, 4)} C${p(-118, -48)} ${p(-70, -90)} ${p(0, -88)}Z`;
}
/** Peripheral zone: posterior and lateral crescent. */
function pzPath() {
  const p = (x, y) => `${f1(CX + x)} ${f1(CY + y)}`;
  return `M${p(-112, -14)} C${p(-118, 52)} ${p(-80, 78)} ${p(0, 76)} C${p(80, 78)} ${p(118, 52)} ${p(112, -14)} C${p(96, 20)} ${p(60, 44)} ${p(0, 46)} C${p(-60, 44)} ${p(-96, 20)} ${p(-112, -14)}Z`;
}

function fmt(lang, v, d) { return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v); }

function metsPanel(d, T, x0, y0) {
  const m = clamp(d.mets ?? 0, 0, 1);
  const op = (0.08 + 0.9 * m).toFixed(2);
  const parts = [`<text class="region" x="${x0}" y="${y0 - 12}">${esc(T.ui.pros.mets)}</text>`];
  ['bone', 'nodes', 'liver', 'lung'].forEach((k, i) => {
    const y = y0 + i * 30;
    // bone first (≈ 90 % of metastatic disease, osteoblastic), viscera late
    const lit = k === 'bone' ? op : k === 'nodes' ? (d.nodes ? 0.95 : op) : (0.08 + 0.9 * m * m * 0.6).toFixed(2);
    parts.push(`<circle class="met-dot" cx="${x0 + 8}" cy="${y}" r="8" opacity="${lit}"/><text class="lab small" x="${x0 + 22}" y="${y + 4}">${esc(T.ui.organ[k])}</text>`);
  });
  if (!d.metsFixed) parts.push(`<text class="lab val" x="${x0}" y="${y0 + 122}">${esc(T.ui.pros.pM)} ${Math.round(m * 100)}%</text>`);
  return parts.join('');
}

function prostateView(d, T, lang) {
  const P = T.ui.pros;
  const K = 0.92; // gland drawing scale
  const X = (x) => CX + (x - CX) * K; const Y = (y) => CY + (y - CY) * K;
  const TX = CX - 62; const TY = CY + 46; // tumour / index lesion site (left posterolateral peripheral zone, unscaled)
  const parts = [];
  const below = []; // one line of text under the rectum
  parts.push(`<rect class="pelvis" x="0" y="0" width="480" height="340" rx="8"/>`);
  parts.push(`<text class="region" x="14" y="22">${esc(P.anterior)}</text><text class="region" x="14" y="332">${esc(P.posterior)}</text>`);
  // radiotherapy beams first, so every label sits on top of them
  if (d.rt) {
    for (const a of [-150, -30, 30, 150, 90]) {
      const rad = (a * Math.PI) / 180;
      parts.push(`<line class="beam" x1="${f1(CX + Math.cos(rad) * 150)}" y1="${f1(CY + Math.sin(rad) * 130)}" x2="${f1(CX + Math.cos(rad) * 60)}" y2="${f1(CY + Math.sin(rad) * 44)}"/>`);
    }
    below.push(P.rt);
  }
  // rectum
  const rk = d.stage && RANK[d.stage] >= 6;
  parts.push(`<path class="rectum${rk ? ' invaded' : ''}" d="M${CX - 66} ${CY + 92} C${CX - 66} ${CY + 78} ${CX + 66} ${CY + 78} ${CX + 66} ${CY + 92} L${CX + 66} ${CY + 122} C${CX + 66} ${CY + 140} ${CX - 66} ${CY + 140} ${CX - 66} ${CY + 122}Z"/>`);
  parts.push(`<text class="lab small" x="${CX}" y="${CY + 116}" text-anchor="middle">${esc(P.rectum)}</text>`);
  // seminal vesicles (posterolateral, at the base)
  const sv = d.stage && RANK[d.stage] >= 5;
  for (const side of [-1, 1]) parts.push(`<ellipse class="sv${sv && side === -1 ? ' invaded' : ''}" cx="${CX + side * 98}" cy="${CY + 84}" rx="28" ry="11" transform="rotate(${side * -18} ${CX + side * 98} ${CY + 84})"/>`);
  parts.push(`<text class="lab small" x="${CX + 76}" y="${CY + 116}">${esc(P.sv)}</text>`);
  // pelvic lymph nodes
  for (const [x, y] of [[24, 112], [28, 136], [300, 108], [304, 128]]) parts.push(`<circle class="node${d.nodes ? ' pos' : ''}" cx="${x}" cy="${y}" r="7"/>`);
  parts.push(`<text class="lab small" x="12" y="74">${esc(P.nodes)}</text>`);

  if (d.removed) {
    parts.push(`<path class="gland removed" d="${glandPath(K)}"/><text class="lab" x="${CX}" y="${CY - 44}" text-anchor="middle">${esc(P.removed)}</text>`);
    parts.push(`<path class="anastomosis" d="M${CX - 16} ${CY - 6} q16 -10 32 0"/><text class="lab small" x="${CX + 22}" y="${CY - 2}">${esc(P.anastomosis)}</text>`);
    if (d.V > 0.02) {
      const r = clamp(Math.cbrt(d.V) * 12, 3, 30);
      parts.push(`<circle class="tumour residual" cx="${X(TX)}" cy="${Y(TY)}" r="${f1(r)}"/><text class="lab small halo" x="${X(TX)}" y="${f1(Y(TY) - r - 6)}" text-anchor="middle">${esc(P.residual)}</text>`);
    }
  } else {
    const g = [];
    g.push(`<path class="gland" d="${glandPath()}"/>`);
    g.push(`<path class="zone pz" d="${pzPath()}"/>`);
    // transition zone: two lobes around the urethra; central zone: posterior wedge around the ejaculatory ducts
    g.push(`<ellipse class="zone tz" cx="${CX - 30}" cy="${CY - 18}" rx="34" ry="28"/><ellipse class="zone tz" cx="${CX + 30}" cy="${CY - 18}" rx="34" ry="28"/>`);
    g.push(`<path class="zone cz" d="M${CX - 40} ${CY + 30} Q${CX} ${CY + 4} ${CX + 40} ${CY + 30} Q${CX} ${CY + 46} ${CX - 40} ${CY + 30}Z"/>`);
    g.push(`<path class="zone afms" d="M${CX - 60} ${CY - 66} Q${CX} ${CY - 96} ${CX + 60} ${CY - 66} Q${CX} ${CY - 52} ${CX - 60} ${CY - 66}Z"/>`);
    g.push(`<circle class="urethra" cx="${CX}" cy="${CY - 26}" r="8"/>`);
    // tumour (peripheral zone, left posterolateral)
    let tr = 0;
    if (!d.hideTumour && d.V > 0.002 && !d.lesion) {
      tr = clamp(Math.cbrt(d.V) * 15, 3, 54);
      g.push(`<circle class="tumour" cx="${TX}" cy="${TY}" r="${f1(tr)}"/>`);
      if (d.stage && RANK[d.stage] >= 4) g.push(`<path class="breach" d="M${f1(TX - tr * 0.7)} ${f1(TY + tr * 0.7)} l-6 8 l6 3 l-5 9M${f1(TX + tr * 0.2)} ${f1(TY + tr)} l2 9 l-5 2 l3 9"/>`);
      if (d.focal) g.push(`<ellipse class="focal-zone" cx="${TX}" cy="${TY}" rx="${f1(tr + 14)}" ry="${f1(tr + 10)}"/>`);
    }
    let sz = 0;
    if (d.lesion) {
      sz = { 1: 0, 2: 6, 3: 10, 4: 14, 5: 22 }[d.lesion];
      if (sz) g.push(`<circle class="lesion p${d.lesion}" cx="${TX}" cy="${TY}" r="${sz}"/>`);
    }
    if (d.cores) {
      for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
        const x = CX + side * (30 + (i % 3) * 26); const y = CY + 18 + Math.floor(i / 3) * 24;
        g.push(`<line class="core" x1="${x - 5}" y1="${y + 9}" x2="${x + 5}" y2="${y - 9}"/>`);
      }
      if (d.cores === 'targeted') for (const k of [-1, 0, 1]) g.push(`<line class="core target" x1="${TX + k * 7 - 6}" y1="${TY + 12}" x2="${TX + k * 7 + 6}" y2="${TY - 12}"/>`);
    }
    if (d.brachy) {
      for (let i = 0; i < 22; i++) {
        const a = i * 2.39996; const rr = 18 + (i * 37 % 70);
        const x = CX + Math.cos(a) * rr * 1.15; const y = CY + 4 + Math.sin(a) * rr * 0.7;
        g.push(`<rect class="seed" x="${f1(x - 3)}" y="${f1(y - 1.2)}" width="6" height="2.4" rx="1" transform="rotate(${(i * 47) % 180} ${f1(x)} ${f1(y)})"/>`);
      }
      below.push(P.brachy);
    }
    parts.push(`<g transform="translate(${CX} ${CY}) scale(${K}) translate(${-CX} ${-CY})">${g.join('')}</g>`);
    // labels (outside the scaled group so text keeps its size)
    const lx = X(CX + 118) + 8;
    const lab = (y, ty, tx, text) => `<line class="leader" x1="${f1(lx - 2)}" y1="${f1(y - 4)}" x2="${f1(X(tx))}" y2="${f1(Y(ty))}"/><text class="lab small halo" x="${f1(lx)}" y="${f1(y)}">${esc(text)}</text>`;
    parts.push(lab(CY - 62, CY - 28, CX + 52, P.tz), lab(CY + 2, CY + 28, CX + 30, P.cz), lab(CY + 46, CY + 52, CX + 92, P.pz));
    parts.push(`<text class="lab small halo" x="${CX}" y="${f1(Y(CY - 88) - 8)}" text-anchor="middle">${esc(P.urethra)}</text>`);
    if (d.lesion) parts.push(`<text class="lab val halo" x="${f1(X(TX) - Math.max(sz, 4) - 6)}" y="${f1(Y(TY) + 4)}" text-anchor="end">PI-RADS ${d.lesion}</text>`);
    if (tr && d.focal) parts.push(`<text class="lab small halo" x="${f1(X(TX))}" y="${f1(Y(TY - tr - 14) - 4)}" text-anchor="middle">${esc(P.focal)}</text>`);
    if (d.cores) {
      below.push(`${d.cores === 'targeted' ? P.coresTargeted : P.coresSystematic} · ${T.opt[d.route]}`);
      if (d.route === 'transrectal') parts.push(`<line class="needle" x1="${CX - 24}" y1="${CY + 108}" x2="${f1(X(TX) + 8)}" y2="${f1(Y(TY) + 6)}"/>`);
      else parts.push(`<line class="needle" x1="${CX - 150}" y1="${CY + 140}" x2="${f1(X(TX) - 4)}" y2="${f1(Y(TY) + 8)}"/>`);
    }
  }
  if (below.length) parts.push(`<text class="lab small halo" x="${CX}" y="316" text-anchor="middle">${esc(below.join(' · '))}</text>`);
  if (d.surveillance) parts.push(`<g class="eye" transform="translate(30 44)"><ellipse rx="12" ry="7"/><circle r="3"/></g><text class="lab small" x="48" y="48">${esc(P.surveillance)}</text>`);
  // badges: PSA, stage, testosterone
  const bx = 214; const by = 12;
  if (d.psa !== undefined) parts.push(`<rect class="badge" x="${bx}" y="${by}" width="120" height="24" rx="12"/><text class="lab val" x="${bx + 60}" y="${by + 16}" text-anchor="middle">PSA ${esc(fmt(lang, d.psa, d.psa < 1 ? 2 : d.psa < 100 ? 1 : 0))}</text>`);
  if (d.stage) parts.push(`<rect class="badge stage" x="${bx - 72}" y="${by}" width="62" height="24" rx="12"/><text class="lab val" x="${bx - 41}" y="${by + 16}" text-anchor="middle">${esc(d.stage === 'M1' ? 'M1' : 'c' + d.stage)}</text>`);
  if (d.adt) parts.push(`<rect class="badge adt" x="380" y="246" width="90" height="40" rx="8"/><text class="lab small" x="425" y="262" text-anchor="middle">${esc(P.adt)}</text><text class="lab val" x="425" y="278" text-anchor="middle">${esc(P.testo(fmt(lang, d.testo ?? 20, 0)))}</text>`);
  parts.push(metsPanel(d, T, 398, 72));
  return { viewBox: '0 0 480 340', body: parts.join('') };
}

export function renderSchematic(host, desc, T, lang, title) {
  const r = prostateView(desc, T, lang);
  host.innerHTML = `<svg class="schem ${desc.kind}" viewBox="${r.viewBox}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${r.body}</svg>`;
}

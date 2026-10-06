/* ==========================================================================
   engine.js — Figura's chart engine. No DOM, no UI.

   Reads an .xlsx package (JSZip), parses each chart part into a plain model
   and redraws it as a display list of paths and text runs, which the back
   ends turn into SVG markup, a PDF page or canvas pixels at any size.

   Classic charts (c:chartSpace): column, bar, line, area, scatter, bubble,
   radar, stock, pie, doughnut, pie of pie and bar of pie, combinations,
   secondary and logarithmic axes, trend lines, error bars, data labels.
   Office 2016 charts (cx:chartSpace): waterfall, funnel, histogram, pareto,
   box and whisker, treemap and sunburst. These are mapped onto the classic
   model wherever they can be (a waterfall is a stacked column with preset
   ends, a funnel a centred bar), so they share its axes, legend and labels.

   Plain (non-module) script: everything is a window global used by scripts.js.
   ========================================================================== */

/* ===== XML and package helpers ===== */
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';

function kids(el, name) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (n.localName === name) out.push(n);
  return out;
}
function kid(el, name) {
  if (!el) return null;
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) if (n.localName === name) return n;
  return null;
}
function path(el, ...names) { for (const n of names) { el = kid(el, n); if (!el) return null; } return el; }
function descs(el, name) { return el ? Array.from(el.getElementsByTagName('*')).filter(n => n.localName === name) : []; }
function aval(el, name, d) { const k = kid(el, name); if (!k) return d; const v = k.getAttribute('val'); return v === null ? d : v; }
function anum(el, name, d) { const v = aval(el, name, null); if (v === null) return d; const n = parseFloat(v); return isFinite(n) ? n : d; }
function abool(el, name, d) { const k = kid(el, name); if (!k) return d; const v = k.getAttribute('val'); return v === null ? true : (v === '1' || v === 'true'); }
function rid(el) { return el.getAttributeNS(NS_R, 'id') || el.getAttribute('r:id'); }
function parseXml(t) { return new DOMParser().parseFromString(t, 'application/xml'); }
function dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dirOf(base) ? dirOf(base).split('/') : [];
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}
async function readText(zip, p) { const f = zip.file(p); return f ? f.async('string') : null; }
async function readRels(zip, part) {
  const relPath = (dirOf(part) ? dirOf(part) + '/' : '') + '_rels/' + part.split('/').pop() + '.rels';
  const t = await readText(zip, relPath);
  const map = {};
  if (!t) return map;
  for (const r of descs(parseXml(t).documentElement, 'Relationship')) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    map[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', target: resolvePath(part, r.getAttribute('Target')) };
  }
  return map;
}
function attrs(s) { const o = {}; for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; }

/* ===== Colour helpers ===== */
function hexToRgb(h) { h = (h || '000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}
function lum(rgb, mod, off) { const [h, s, l] = rgb2hsl(...rgb); return hsl2rgb(h, s, Math.max(0, Math.min(1, l * mod + off))); }
const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080' };
function parseColorEl(el, theme) {
  if (!el) return null;
  let hex;
  switch (el.localName) {
    case 'srgbClr': hex = el.getAttribute('val'); break;
    case 'schemeClr': {
      let n = el.getAttribute('val'); n = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[n] || n;
      hex = theme.colors[n] || theme.colors.accent1; break;
    }
    case 'sysClr': hex = el.getAttribute('lastClr') || (el.getAttribute('val') === 'window' ? 'FFFFFF' : '000000'); break;
    case 'prstClr': hex = PRESET[el.getAttribute('val')] || '000000'; break;
    case 'scrgbClr': {
      const f = k => Math.round(Math.pow(Math.min(1, Math.max(0, +el.getAttribute(k) / 100000)), 1 / 2.2) * 255);
      hex = rgbToHex(f('r'), f('g'), f('b')); break;
    }
    case 'hslClr': {
      const rgb = hsl2rgb(+el.getAttribute('hue') / 21600000, +el.getAttribute('sat') / 100000, +el.getAttribute('lum') / 100000);
      hex = rgbToHex(...rgb); break;
    }
    default: return null;
  }
  let rgb = hexToRgb(hex), a = 1;
  for (const m of Array.from(el.children)) {
    const v = +m.getAttribute('val') / 100000;
    if (!isFinite(v)) continue;
    switch (m.localName) {
      case 'lumMod': rgb = lum(rgb, v, 0); break;
      case 'lumOff': rgb = lum(rgb, 1, v); break;
      case 'shade': rgb = rgb.map(c => c * v); break;
      case 'tint': rgb = rgb.map(c => 255 - (255 - c) * v); break;
      case 'satMod': { const [h, s, l] = rgb2hsl(...rgb); rgb = hsl2rgb(h, Math.min(1, s * v), l); break; }
      case 'alpha': a = v; break;
    }
  }
  return { c: rgbToHex(...rgb), a };
}
function colorOf(hex, a) { return { c: hex.startsWith('#') ? hex : '#' + hex, a: a == null ? 1 : a }; }

function defaultTheme() {
  return {
    colors: { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' },
    minorFont: 'Calibri', majorFont: 'Calibri Light'
  };
}
function parseTheme(doc) {
  const t = defaultTheme();
  const cs = descs(doc.documentElement, 'clrScheme')[0];
  if (cs) for (const c of Array.from(cs.children)) {
    const s = c.firstElementChild; if (!s) continue;
    const v = s.localName === 'sysClr' ? (s.getAttribute('lastClr') || (s.getAttribute('val') === 'window' ? 'FFFFFF' : '000000')) : s.getAttribute('val');
    if (v) t.colors[c.localName] = v;
  }
  const fs = descs(doc.documentElement, 'fontScheme')[0];
  if (fs) {
    const mj = path(fs, 'majorFont', 'latin'), mn = path(fs, 'minorFont', 'latin');
    if (mj && mj.getAttribute('typeface')) t.majorFont = mj.getAttribute('typeface');
    if (mn && mn.getAttribute('typeface')) t.minorFont = mn.getAttribute('typeface');
  }
  return t;
}
function seriesColor(theme, i) {
  const base = hexToRgb(theme.colors['accent' + ((i % 6) + 1)]);
  const [mod, off] = [[1, 0], [0.6, 0], [0.8, 0.2], [0.8, 0], [0.6, 0.4], [0.5, 0]][Math.floor(i / 6) % 6];
  return { c: rgbToHex(...lum(base, mod, off)), a: 1 };
}

/* ===== Shape and text properties ===== */
function fillFrom(container, theme) {
  if (!container) return undefined;
  for (const ch of Array.from(container.children)) {
    if (ch.localName === 'noFill') return null;
    if (ch.localName === 'solidFill') return parseColorEl(ch.firstElementChild, theme);
    if (ch.localName === 'gradFill') { const gs = descs(ch, 'gs')[0]; return gs ? parseColorEl(gs.firstElementChild, theme) : undefined; }
    if (ch.localName === 'pattFill') { const fg = kid(ch, 'fgClr'); return fg ? parseColorEl(fg.firstElementChild, theme) : undefined; }
  }
  return undefined;
}
function lineFrom(sp, theme) {
  const ln = kid(sp, 'ln');
  if (!ln) return undefined;
  const o = {};
  if (ln.getAttribute('w')) o.w = +ln.getAttribute('w') / 12700;
  if (ln.getAttribute('cap')) o.cap = ln.getAttribute('cap');
  for (const ch of Array.from(ln.children)) {
    if (ch.localName === 'noFill') o.none = true;
    else if (ch.localName === 'solidFill') o.color = parseColorEl(ch.firstElementChild, theme);
    else if (ch.localName === 'gradFill') { const gs = descs(ch, 'gs')[0]; if (gs) o.color = parseColorEl(gs.firstElementChild, theme); }
    else if (ch.localName === 'prstDash') o.dash = ch.getAttribute('val');
  }
  return o;
}
function shapeProps(sp, theme) { return { fill: fillFrom(sp, theme), line: lineFrom(sp, theme) }; }
function resolveFace(face, theme) {
  if (!face) return undefined;
  if (face === '+mn-lt') return theme.minorFont;
  if (face === '+mj-lt') return theme.majorFont;
  if (face.startsWith('+')) return theme.minorFont;
  return face;
}
function rPr(r, theme) {
  const f = {};
  if (!r) return f;
  const sz = r.getAttribute('sz'); if (sz) f.size = +sz / 100;
  const b = r.getAttribute('b'); if (b !== null) f.bold = b === '1' || b === 'true';
  const i = r.getAttribute('i'); if (i !== null) f.italic = i === '1' || i === 'true';
  const bl = r.getAttribute('baseline'); if (bl && +bl !== 0) f.baseline = +bl / 100000;
  const sf = kid(r, 'solidFill'); if (sf) f.color = parseColorEl(sf.firstElementChild, theme);
  const lt = kid(r, 'latin'); if (lt) { const fam = resolveFace(lt.getAttribute('typeface'), theme); if (fam) f.family = fam; }
  return f;
}
function txPr(el, theme) {
  if (!el) return {};
  const body = kid(el, 'bodyPr');
  const p = kid(el, 'p');
  const f = rPr(path(p, 'pPr', 'defRPr'), theme);
  if (body) {
    const rot = body.getAttribute('rot');
    if (rot !== null && rot !== '' && +rot !== -60000000) f.rot = +rot / 60000;
    const vert = body.getAttribute('vert');
    if (vert && vert !== 'horz') f.vert = vert;
  }
  return f;
}
function richLines(rich, theme) {
  const lines = [];
  for (const p of kids(rich, 'p')) {
    const pdef = rPr(path(p, 'pPr', 'defRPr'), theme);
    let line = [];
    for (const r of Array.from(p.children)) {
      if (r.localName === 'r' || r.localName === 'fld') {
        const t = kid(r, 't'); const text = t ? t.textContent : '';
        if (text) {
          const parts = text.split(/\r?\n/);
          parts.forEach((pt, k) => { if (k > 0) { lines.push(line); line = []; } if (pt) line.push({ text: pt, f: Object.assign({}, pdef, rPr(kid(r, 'rPr'), theme)) }); });
        }
      } else if (r.localName === 'br') { lines.push(line); line = []; }
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  return lines;
}
function manualLayout(layoutEl) {
  const m = path(layoutEl, 'manualLayout');
  if (!m) return null;
  return {
    target: aval(m, 'layoutTarget', 'outer'), xMode: aval(m, 'xMode', 'factor'), yMode: aval(m, 'yMode', 'factor'),
    wMode: aval(m, 'wMode', 'factor'), hMode: aval(m, 'hMode', 'factor'),
    x: anum(m, 'x', null), y: anum(m, 'y', null), w: anum(m, 'w', null), h: anum(m, 'h', null)
  };
}

/* ===== Data ===== */
function toNum(s) { if (s === null || s === undefined || s === '') return null; const n = Number(s); return isFinite(n) ? n : null; }
function fromCache(cache, isNum) {
  const count = Math.max(anum(cache, 'ptCount', 0), 0);
  const strs = new Array(count).fill(null);
  for (const pt of kids(cache, 'pt')) {
    const i = +pt.getAttribute('idx'); const v = kid(pt, 'v');
    if (v && i >= 0) { if (i >= strs.length) strs.length = i + 1; strs[i] = v.textContent; }
  }
  for (let i = 0; i < strs.length; i++) if (strs[i] === undefined) strs[i] = null;
  const fc = kid(cache, 'formatCode');
  return { strs, nums: strs.map(toNum), isNum, fmt: fc ? fc.textContent : null };
}
function fromValues(vals, isNum) {
  const strs = vals.map(v => v === null || v === undefined ? null : String(v));
  return { strs, nums: strs.map(toNum), isNum: isNum && vals.some(v => typeof v === 'number'), fmt: null };
}
function readData(el, R) {
  if (!el) return null;
  let r;
  if ((r = kid(el, 'numRef'))) { const c = kid(r, 'numCache'); if (c) return fromCache(c, true); return fromValues(R.get(kid(r, 'f')), true); }
  if ((r = kid(el, 'numLit'))) return fromCache(r, true);
  if ((r = kid(el, 'strRef'))) { const c = kid(r, 'strCache'); if (c) return fromCache(c, false); return fromValues(R.get(kid(r, 'f')), false); }
  if ((r = kid(el, 'strLit'))) return fromCache(r, false);
  if ((r = kid(el, 'multiLvlStrRef'))) {
    const c = kid(r, 'multiLvlStrCache');
    if (c) {
      const count = anum(c, 'ptCount', 0); const strs = new Array(count).fill(null);
      const lvl = kid(c, 'lvl');
      for (const pt of kids(lvl, 'pt')) { const v = kid(pt, 'v'); strs[+pt.getAttribute('idx')] = v ? v.textContent : null; }
      return { strs, nums: strs.map(toNum), isNum: false, fmt: null };
    }
    return fromValues(R.get(kid(r, 'f')), false);
  }
  const v = kid(el, 'v'); if (v) return { strs: [v.textContent], nums: [toNum(v.textContent)], isNum: false, fmt: null };
  return null;
}

/* Fallback when a chart has no cached values: read the referenced cells */
function colIndex(letters) { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
async function makeResolver(zip, wbRels, sheetPaths) {
  let shared = null;
  const sheetCache = {};
  const values = {};
  async function sharedStrings() {
    if (shared) return shared;
    shared = [];
    const rel = Object.values(wbRels).find(r => /sharedStrings$/.test(r.type));
    const t = rel && await readText(zip, rel.target);
    if (t) for (const si of descs(parseXml(t).documentElement, 'si')) shared.push(descs(si, 't').map(x => x.textContent).join(''));
    return shared;
  }
  async function sheetCells(name) {
    if (sheetCache[name]) return sheetCache[name];
    const p = sheetPaths[name]; const cells = {};
    const t = p && await readText(zip, p);
    if (t) {
      const ss = await sharedStrings();
      for (const c of descs(parseXml(t).documentElement, 'c')) {
        const ref = c.getAttribute('r'); if (!ref) continue;
        const type = c.getAttribute('t'); const v = kid(c, 'v');
        let val = null;
        if (type === 's') val = v ? ss[+v.textContent] : null;
        else if (type === 'inlineStr') val = descs(c, 't').map(x => x.textContent).join('');
        else if (type === 'str' || type === 'e') val = v ? v.textContent : null;
        else if (type === 'b') val = v ? (v.textContent === '1' ? 'TRUE' : 'FALSE') : null;
        else val = v ? Number(v.textContent) : null;
        cells[ref.replace(/\$/g, '')] = val;
      }
    }
    return (sheetCache[name] = cells);
  }
  async function resolveFormula(f) {
    const out = [];
    const areas = f.replace(/^\(|\)$/g, '').split(/,(?=(?:[^']*'[^']*')*[^']*$)/);
    for (const area of areas) {
      const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(area.trim());
      if (!m) continue;
      const sheet = (m[1] ? m[1].replace(/''/g, "'") : m[2]).trim();
      const cells = await sheetCells(sheet);
      const c1 = colIndex(m[3]), r1 = +m[4], c2 = m[5] ? colIndex(m[5]) : c1, r2 = m[6] ? +m[6] : r1;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        let col = '', n = c + 1; while (n > 0) { const k = (n - 1) % 26; col = String.fromCharCode(65 + k) + col; n = Math.floor((n - 1) / 26); }
        const v = cells[col + r]; out.push(v === undefined ? null : v);
      }
    }
    return out;
  }
  return {
    async prepare(doc) {
      // Classic refs carry a cache next to the formula; Office 2016 dimensions
      // carry cached levels (cx:lvl) and series names a cached value (cx:v).
      for (const tag of ['numRef', 'strRef', 'multiLvlStrRef', 'strDim', 'numDim', 'txData']) for (const r of descs(doc.documentElement, tag)) {
        if (kid(r, 'numCache') || kid(r, 'strCache') || kid(r, 'multiLvlStrCache') || kid(r, 'lvl') || kid(r, 'v')) continue;
        const f = kid(r, 'f'); if (!f) continue;
        const key = f.textContent.trim();
        if (!(key in values)) { try { values[key] = await resolveFormula(key); } catch (e) { values[key] = []; } }
      }
    },
    get(fEl) { return fEl ? (values[fEl.textContent.trim()] || []) : []; }
  };
}

/* ===== Chart parsing ===== */
/* Lower case: drawn. Capitalised: recognised but not drawn (the name is shown). */
const GROUP_TYPES = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', stockChart: 'line', scatterChart: 'scatter',
  areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut',
  radarChart: 'radar', bubbleChart: 'bubble', surfaceChart: 'Surface', surface3DChart: 'Surface'
};

function parseTitle(t, theme, R) {
  if (!t) return null;
  const tx = kid(t, 'tx');
  const o = { font: txPr(kid(t, 'txPr'), theme), layout: manualLayout(kid(t, 'layout')), overlay: abool(t, 'overlay', false), lines: null };
  Object.assign(o, shapeProps(kid(t, 'spPr'), theme));
  const rich = kid(tx, 'rich');
  if (rich) { o.lines = richLines(rich, theme); Object.assign(o.font, txPr(rich, theme)); }
  else if (kid(tx, 'strRef')) { const d = readData(tx, R); const s = d ? d.strs.filter(x => x != null).join(' ') : ''; o.lines = [[{ text: s, f: {} }]]; }
  return o;
}
function parseDLbls(el, theme) {
  if (!el) return null;
  const o = {
    del: abool(el, 'delete', false),
    val: abool(el, 'showVal', false), cat: abool(el, 'showCatName', false), ser: abool(el, 'showSerName', false),
    pct: abool(el, 'showPercent', false), bub: abool(el, 'showBubbleSize', false), pos: aval(el, 'dLblPos', null), sep: null,
    font: txPr(kid(el, 'txPr'), theme), hidden: new Set()
  };
  const sep = kid(el, 'separator'); if (sep) o.sep = sep.textContent;
  const nf = kid(el, 'numFmt'); if (nf) o.numFmt = { code: nf.getAttribute('formatCode'), linked: nf.getAttribute('sourceLinked') === '1' };
  for (const d of kids(el, 'dLbl')) if (abool(d, 'delete', false)) o.hidden.add(anum(d, 'idx', -1));
  return o;
}
function parseTrend(t, theme) {
  const sp = kid(t, 'spPr');
  const lbl = kid(t, 'trendlineLbl'); const nf = kid(lbl, 'numFmt');
  const nm = kid(t, 'name');
  return {
    type: aval(t, 'trendlineType', 'linear'), order: anum(t, 'order', 2), period: anum(t, 'period', 2),
    forward: anum(t, 'forward', 0), backward: anum(t, 'backward', 0), intercept: anum(t, 'intercept', null),
    dispEq: abool(t, 'dispEq', false), dispR2: abool(t, 'dispRSqr', false), name: nm ? nm.textContent : null,
    line: lineFrom(sp, theme), lblFont: txPr(kid(lbl, 'txPr'), theme), lblFmt: nf ? nf.getAttribute('formatCode') : null,
    lblLayout: manualLayout(kid(lbl, 'layout'))
  };
}
function parseErr(e, theme, R) {
  return {
    dir: aval(e, 'errDir', 'y'), type: aval(e, 'errBarType', 'both'), valType: aval(e, 'errValType', 'fixedVal'),
    noCap: abool(e, 'noEndCap', false), val: anum(e, 'val', 1),
    plus: readData(kid(e, 'plus'), R), minus: readData(kid(e, 'minus'), R), line: lineFrom(kid(e, 'spPr'), theme)
  };
}
function parseMarker(mk, theme) {
  if (!mk) return null;
  const sp = kid(mk, 'spPr');
  return { symbol: aval(mk, 'symbol', null), size: anum(mk, 'size', null), fill: fillFrom(sp, theme), line: lineFrom(sp, theme) };
}
function parseSeries(ser, type, theme, R) {
  const s = { idx: anum(ser, 'idx', 0) };
  s.order = anum(ser, 'order', s.idx);
  const tx = readData(kid(ser, 'tx'), R);
  s.name = tx ? tx.strs.filter(x => x != null).join(' ') : '';
  if (!s.name) s.name = 'Series' + (s.idx + 1);
  Object.assign(s, shapeProps(kid(ser, 'spPr'), theme));
  if (type === 'scatter' || type === 'bubble') { s.x = readData(kid(ser, 'xVal'), R); s.y = readData(kid(ser, 'yVal'), R); }
  else { s.x = readData(kid(ser, 'cat'), R); s.y = readData(kid(ser, 'val'), R); }
  if (type === 'bubble') s.size = readData(kid(ser, 'bubbleSize'), R);
  s.marker = parseMarker(kid(ser, 'marker'), theme);
  s.smooth = abool(ser, 'smooth', false);
  s.invert = abool(ser, 'invertIfNegative', false);
  const inv = descs(ser, 'invertSolidFillFmt')[0];
  if (inv) s.invertFill = fillFrom(kid(inv, 'spPr'), theme);
  s.explosion = anum(ser, 'explosion', 0);
  s.dPts = {};
  for (const d of kids(ser, 'dPt')) {
    const sp = kid(d, 'spPr');
    s.dPts[anum(d, 'idx', 0)] = Object.assign(shapeProps(sp, theme), { explosion: anum(d, 'explosion', null), marker: parseMarker(kid(d, 'marker'), theme) });
  }
  s.dLbls = parseDLbls(kid(ser, 'dLbls'), theme);
  s.trends = kids(ser, 'trendline').map(t => parseTrend(t, theme));
  s.errs = kids(ser, 'errBars').map(e => parseErr(e, theme, R));
  return s;
}
function parseAxis(el, theme) {
  const a = { id: aval(el, 'axId', null), kind: { catAx: 'cat', valAx: 'val', dateAx: 'date', serAx: 'ser' }[el.localName] };
  const sc = kid(el, 'scaling');
  a.deleted = abool(el, 'delete', false);
  a.reversed = aval(sc, 'orientation', 'minMax') === 'maxMin';
  a.min = anum(sc, 'min', null); a.max = anum(sc, 'max', null); a.logBase = anum(sc, 'logBase', null);
  a.pos = aval(el, 'axPos', 'b');
  const mg = kid(el, 'majorGridlines'), ng = kid(el, 'minorGridlines');
  a.majorGrid = mg ? (lineFrom(kid(mg, 'spPr'), theme) || {}) : null;
  a.minorGrid = ng ? (lineFrom(kid(ng, 'spPr'), theme) || {}) : null;
  a.title = parseTitle(kid(el, 'title'), theme, { get: () => [] });
  const nf = kid(el, 'numFmt');
  a.numFmt = nf ? { code: nf.getAttribute('formatCode'), linked: nf.getAttribute('sourceLinked') === '1' } : null;
  a.majorTick = aval(el, 'majorTickMark', 'out'); a.minorTick = aval(el, 'minorTickMark', 'none');
  a.lblPos = aval(el, 'tickLblPos', 'nextTo');
  a.line = lineFrom(kid(el, 'spPr'), theme);
  a.font = txPr(kid(el, 'txPr'), theme);
  a.crossAx = aval(el, 'crossAx', null);
  a.crossesAt = anum(el, 'crossesAt', null);
  a.crosses = aval(el, 'crosses', a.crossesAt != null ? null : 'autoZero');
  a.crossBetween = aval(el, 'crossBetween', null);
  a.majorUnit = anum(el, 'majorUnit', null); a.minorUnit = anum(el, 'minorUnit', null);
  a.lblSkip = anum(el, 'tickLblSkip', null); a.markSkip = anum(el, 'tickMarkSkip', null);
  const du = kid(el, 'dispUnits');
  if (du) {
    const b = aval(du, 'builtInUnit', null);
    a.dispDiv = { hundreds: 1e2, thousands: 1e3, tenThousands: 1e4, hundredThousands: 1e5, millions: 1e6, tenMillions: 1e7, hundredMillions: 1e8, billions: 1e9, trillions: 1e12 }[b] || anum(du, 'custUnit', 1);
  }
  return a;
}

/* A line element that is present but unstyled still means "draw it". */
function optLine(el, theme) { return el ? (lineFrom(kid(el, 'spPr'), theme) || {}) : null; }
function parseUpDown(el, theme) {
  if (!el) return null;
  return { gap: anum(el, 'gapWidth', 150), up: shapeProps(kid(kid(el, 'upBars'), 'spPr'), theme), down: shapeProps(kid(kid(el, 'downBars'), 'spPr'), theme) };
}
function parseOfPie(el, theme) {
  const cs = kid(el, 'custSplit');
  return {
    type: aval(el, 'ofPieType', 'pie'), splitType: aval(el, 'splitType', 'auto'), splitPos: anum(el, 'splitPos', null),
    cust: cs ? kids(cs, 'secondPiePt').map(e => +e.getAttribute('val')) : [],
    second: anum(el, 'secondPieSize', 75), gap: anum(el, 'gapWidth', 100), serLines: optLine(kid(el, 'serLines'), theme)
  };
}

async function parseChart(doc, theme, R) {
  await R.prepare(doc);
  const cs = doc.documentElement;
  const chart = kid(cs, 'chart');
  const pa = kid(chart, 'plotArea');
  const m = { theme, groups: [], axes: {}, unsupported: null, is3D: false };
  m.baseFont = txPr(kid(cs, 'txPr'), theme);
  Object.assign(m, { chartFill: fillFrom(kid(cs, 'spPr'), theme), chartLine: lineFrom(kid(cs, 'spPr'), theme) });
  m.plotFill = fillFrom(kid(pa, 'spPr'), theme); m.plotLine = lineFrom(kid(pa, 'spPr'), theme);
  m.plotLayout = manualLayout(kid(pa, 'layout'));
  m.autoTitleDeleted = abool(chart, 'autoTitleDeleted', false);
  m.title = parseTitle(kid(chart, 'title'), theme, R);
  m.blanks = aval(chart, 'dispBlanksAs', 'gap');
  const lg = kid(chart, 'legend');
  if (lg) {
    m.legend = { pos: aval(lg, 'legendPos', 'r'), layout: manualLayout(kid(lg, 'layout')), overlay: abool(lg, 'overlay', false), font: txPr(kid(lg, 'txPr'), theme), hidden: new Set() };
    Object.assign(m.legend, shapeProps(kid(lg, 'spPr'), theme));
    for (const e of kids(lg, 'legendEntry')) if (abool(e, 'delete', false)) m.legend.hidden.add(anum(e, 'idx', -1));
  }
  for (const el of Array.from(pa ? pa.children : [])) {
    if (/Ax$/.test(el.localName)) { const a = parseAxis(el, theme); m.axes[a.id] = a; continue; }
    const type = GROUP_TYPES[el.localName];
    if (!type) continue;
    if (/3D/.test(el.localName)) m.is3D = true;
    if (/^[A-Z]/.test(type)) { m.unsupported = type; continue; }
    const g = {
      type, barDir: aval(el, 'barDir', 'col'),
      grouping: aval(el, 'grouping', type === 'bar' ? 'clustered' : 'standard'),
      varyColors: abool(el, 'varyColors', type === 'pie' || type === 'doughnut'),
      gapWidth: anum(el, 'gapWidth', 150), overlap: anum(el, 'overlap', null),
      holeSize: anum(el, 'holeSize', 50), firstSliceAng: anum(el, 'firstSliceAng', 0),
      scatterStyle: aval(el, 'scatterStyle', 'lineMarker'), showMarker: abool(el, 'marker', true),
      axIds: kids(el, 'axId').map(e => e.getAttribute('val')),
      dLbls: parseDLbls(kid(el, 'dLbls'), theme),
      radarStyle: aval(el, 'radarStyle', 'marker'),
      bubbleScale: anum(el, 'bubbleScale', 100), showNeg: abool(el, 'showNegBubbles', false), sizeRep: aval(el, 'sizeRepresents', 'area'),
      stock: el.localName === 'stockChart',
      hiLow: optLine(kid(el, 'hiLowLines'), theme), dropLines: optLine(kid(el, 'dropLines'), theme),
      upDown: parseUpDown(kid(el, 'upDownBars'), theme),
      ofPie: el.localName === 'ofPieChart' ? parseOfPie(el, theme) : null
    };
    g.series = kids(el, 'ser').map(s => parseSeries(s, type, theme, R));
    m.groups.push(g);
  }
  if (!m.groups.length && !m.unsupported) m.unsupported = 'Empty';
  return m;
}

/* ===== Workbook loading ===== */
async function sheetGeometry(zip, p) {
  const t = (await readText(zip, p)) || '';
  const g = { defColPx: 64, defRowPt: 15, cols: [], rows: [] };
  const colPx = w => Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7);
  const fm = /<(?:\w+:)?sheetFormatPr\b([^>]*)>/.exec(t);
  if (fm) {
    const a = attrs(fm[1]);
    if (a.defaultRowHeight) g.defRowPt = +a.defaultRowHeight;
    if (a.defaultColWidth) g.defColPx = colPx(+a.defaultColWidth);
    else if (a.baseColWidth) g.defColPx = Math.round(+a.baseColWidth * 7 + 8);
  }
  for (const m of t.matchAll(/<(?:\w+:)?col\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]); const lo = +a.min, hi = Math.min(+a.max, 16384);
    const px = (a.hidden === '1' || a.hidden === 'true') ? 0 : (a.width !== undefined ? colPx(+a.width) : g.defColPx);
    for (let c = lo; c <= hi; c++) g.cols[c - 1] = px;
  }
  for (const m of t.matchAll(/<(?:\w+:)?row\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]); if (!a.r) continue;
    const hidden = a.hidden === '1' || a.hidden === 'true';
    if (hidden) g.rows[+a.r - 1] = 0; else if (a.ht !== undefined) g.rows[+a.r - 1] = +a.ht;
  }
  return g;
}
function anchorSize(an, geom) {
  if (an.localName !== 'twoCellAnchor') {
    const ext = kid(an, 'ext');
    if (ext && +ext.getAttribute('cx') > 0) return { cx: +ext.getAttribute('cx'), cy: +ext.getAttribute('cy') };
  } else if (geom) {
    const rd = e => ({ col: +((kid(e, 'col') || {}).textContent || 0), colOff: +((kid(e, 'colOff') || {}).textContent || 0), row: +((kid(e, 'row') || {}).textContent || 0), rowOff: +((kid(e, 'rowOff') || {}).textContent || 0) });
    const a = rd(kid(an, 'from')), b = rd(kid(an, 'to'));
    const X = p => { let s = 0; for (let i = 0; i < p.col; i++) s += (geom.cols[i] ?? geom.defColPx) * 9525; return s + p.colOff; };
    const Y = p => { let s = 0; for (let i = 0; i < p.row; i++) s += (geom.rows[i] ?? geom.defRowPt) * 12700; return s + p.rowOff; };
    const cx = X(b) - X(a), cy = Y(b) - Y(a);
    if (cx > 0 && cy > 0) return { cx, cy };
  }
  const xf = descs(an, 'xfrm')[0]; const e2 = kid(xf, 'ext');
  if (e2 && +e2.getAttribute('cx') > 0) return { cx: +e2.getAttribute('cx'), cy: +e2.getAttribute('cy') };
  return { cx: 4572000, cy: 2743200 };
}
const CHARTEX_NAMES = { clusteredColumn: 'Histogram', paretoLine: 'Pareto', boxWhisker: 'Box and whisker', waterfall: 'Waterfall', treemap: 'Treemap', sunburst: 'Sunburst', funnel: 'Funnel', regionMap: 'Map' };

/* ===== Office 2016 charts (chartex) ===== */
function exNum(el, name) { const v = el && el.getAttribute(name); if (v == null || v === '' || v === 'auto') return null; const n = parseFloat(v); return isFinite(n) ? n : null; }
/* Chartex keeps its default run formatting on the first run of txPr, not only on defRPr. */
function exFont(el, theme) { if (!el) return {}; return Object.assign(txPr(el, theme), rPr(path(el, 'p', 'r', 'rPr'), theme)); }
function exText(tx, R) {
  if (!tx) return null;
  const rich = kid(tx, 'rich'); if (rich) return { rich };
  const td = kid(tx, 'txData'); if (!td) return null;
  const v = kid(td, 'v'); if (v) return { text: v.textContent };
  const f = kid(td, 'f'); if (f) return { text: R.get(f).filter(x => x != null).join(' ') };
  return null;
}
function parseExTitle(t, theme, R) {
  if (!t) return null;
  const o = { font: exFont(kid(t, 'txPr'), theme), layout: null, overlay: t.getAttribute('overlay') === '1', lines: null };
  Object.assign(o, shapeProps(kid(t, 'spPr'), theme));
  const tx = exText(kid(t, 'tx'), R);
  if (tx && tx.rich) { o.lines = richLines(tx.rich, theme); Object.assign(o.font, txPr(tx.rich, theme)); }
  else if (tx && tx.text != null) o.lines = [[{ text: tx.text, f: {} }]];
  else if (kid(t, 'txPr')) o.lines = richLines(kid(t, 'txPr'), theme).map(l => l.map(r => ({ text: r.text, f: {} })));
  return o;
}
function parseExDim(dim, R) {
  const levels = kids(dim, 'lvl').map(l => {
    const strs = new Array(Math.max(+l.getAttribute('ptCount') || 0, 0)).fill(null);
    for (const pt of kids(l, 'pt')) { const i = +pt.getAttribute('idx'); if (i >= 0) { if (i >= strs.length) strs.length = i + 1; strs[i] = pt.textContent; } }
    for (let i = 0; i < strs.length; i++) if (strs[i] === undefined) strs[i] = null;
    return { strs, nums: strs.map(toNum), fmt: l.getAttribute('formatCode') || null };
  });
  if (!levels.length) {
    const f = kid(dim, 'f');
    if (f) { const vals = R.get(f); levels.push({ strs: vals.map(v => v == null ? null : String(v)), nums: vals.map(v => typeof v === 'number' ? v : toNum(v)), fmt: null }); }
  }
  return { type: dim.getAttribute('type'), levels };
}
function parseExDLbls(el, theme) {
  if (!el) return null;
  const vis = kid(el, 'visibility');
  const flag = (n, d) => { const v = vis && vis.getAttribute(n); return v == null ? d : v === '1' || v === 'true'; };
  const o = {
    del: false, val: flag('value', true), cat: flag('categoryName', false), ser: flag('seriesName', false), pct: false, bub: false,
    pos: el.getAttribute('pos') || null, sep: null, font: exFont(kid(el, 'txPr'), theme), hidden: new Set()
  };
  const sep = kid(el, 'separator'); if (sep) o.sep = sep.textContent;
  const nf = kid(el, 'numFmt'); if (nf) o.numFmt = { code: nf.getAttribute('formatCode'), linked: nf.getAttribute('sourceLinked') === '1' };
  for (const h of kids(el, 'dataLabelHidden')) o.hidden.add(+h.getAttribute('idx'));
  return o;
}
function parseExSeries(el, theme, R, i) {
  const s = { idx: i, layoutId: el.getAttribute('layoutId'), hidden: el.getAttribute('hidden') === '1' };
  const tx = exText(kid(el, 'tx'), R);
  s.name = (tx && (tx.text || (tx.rich && tx.rich.textContent))) || '';
  // Excel leaves the pareto line unnamed; its legend calls it the cumulative share.
  if (!s.name) s.name = s.layoutId === 'paretoLine' ? 'Cumulative %' : 'Series' + (i + 1);
  Object.assign(s, shapeProps(kid(el, 'spPr'), theme));
  s.dPts = {};
  for (const d of kids(el, 'dataPt')) s.dPts[+d.getAttribute('idx')] = Object.assign(shapeProps(kid(d, 'spPr'), theme), { explosion: null, marker: null });
  s.dLbls = parseExDLbls(kid(el, 'dataLabels'), theme);
  const di = kid(el, 'dataId'); s.dataId = di ? di.getAttribute('val') : '0';
  const lp = kid(el, 'layoutPr'), o = {};
  if (lp) {
    const st = kid(lp, 'subtotals'); if (st) o.subtotals = new Set(kids(st, 'idx').map(e => +e.getAttribute('val')));
    const bn = kid(lp, 'binning');
    if (bn) o.binning = { closed: bn.getAttribute('intervalClosed') || 'r', under: exNum(bn, 'underflow'), over: exNum(bn, 'overflow'), count: anum(bn, 'binCount', null), size: anum(bn, 'binSize', null) };
    if (kid(lp, 'aggregation')) o.aggregation = true;
    const vis = kid(lp, 'visibility');
    if (vis) { o.vis = {}; for (const a of Array.from(vis.attributes)) o.vis[a.localName] = a.value === '1' || a.value === 'true'; }
    const qs = kid(lp, 'statistics'); if (qs) o.quartile = qs.getAttribute('quartileMethod') || 'exclusive';
    const pl = kid(lp, 'parentLabelLayout'); if (pl) o.parentLabel = pl.getAttribute('val');
  }
  s.lp = o;
  return s;
}
function parseExAxis(el, theme, R) {
  const cs = kid(el, 'catScaling'), vs = kid(el, 'valScaling');
  const a = { id: el.getAttribute('id'), hidden: el.getAttribute('hidden') === '1', kind: cs ? 'cat' : 'val', gap: exNum(cs, 'gapWidth') };
  if (vs) { a.min = exNum(vs, 'min'); a.max = exNum(vs, 'max'); a.majorUnit = exNum(vs, 'majorUnit'); a.minorUnit = exNum(vs, 'minorUnit'); }
  a.title = parseExTitle(kid(el, 'title'), theme, R);
  a.majorGrid = optLine(kid(el, 'majorGridlines'), theme);
  a.minorGrid = optLine(kid(el, 'minorGridlines'), theme);
  const mt = kid(el, 'majorTickMarks'), nt = kid(el, 'minorTickMarks');
  a.majorTick = mt ? (mt.getAttribute('type') || 'out') : 'none';
  a.minorTick = nt ? (nt.getAttribute('type') || 'out') : 'none';
  a.tickLabels = !!kid(el, 'tickLabels');
  const nf = kid(el, 'numFmt'); a.numFmt = nf ? { code: nf.getAttribute('formatCode'), linked: nf.getAttribute('sourceLinked') === '1' } : null;
  a.line = lineFrom(kid(el, 'spPr'), theme);
  a.font = exFont(kid(el, 'txPr'), theme);
  return a;
}
/* A classic axis object with every field the renderer reads. */
function blankAxis(id, kind, pos, extra) {
  return Object.assign({
    id, kind, deleted: true, reversed: false, min: null, max: null, logBase: null, pos, majorGrid: null, minorGrid: null,
    title: null, numFmt: null, majorTick: 'none', minorTick: 'none', lblPos: 'none', line: undefined, font: {},
    crossAx: null, crosses: 'autoZero', crossesAt: null, crossBetween: null, majorUnit: null, minorUnit: null, lblSkip: null, markSkip: null
  }, extra);
}
/* Chartex axes draw no line or ticks unless asked to. */
function exToAxis(ex, id, kind, pos, extra) {
  if (!ex) return blankAxis(id, kind, pos, extra);
  return blankAxis(id, kind, pos, Object.assign({
    deleted: ex.hidden, min: ex.min, max: ex.max, majorUnit: ex.majorUnit, minorUnit: ex.minorUnit, majorGrid: ex.majorGrid, minorGrid: ex.minorGrid,
    title: ex.title, numFmt: ex.numFmt, majorTick: ex.majorTick, minorTick: ex.minorTick, lblPos: ex.tickLabels ? 'nextTo' : 'none',
    line: ex.line !== undefined ? ex.line : { none: true }, font: ex.font, gapRatio: ex.gap
  }, extra));
}
function linkAxes(m, a, b) { a.crossAx = b.id; b.crossAx = a.id; m.axes[a.id] = a; m.axes[b.id] = b; }
const strData = strs => ({ strs, nums: strs.map(toNum), isNum: false, fmt: null });
const numData = (nums, fmt) => ({ strs: nums.map(v => v == null ? null : String(v)), nums, isNum: true, fmt: fmt || null });
/* A chartex series reshaped as a classic one. */
function exSer(s, extra) {
  return Object.assign({
    idx: s.idx, order: s.idx, name: s.name, fill: s.fill, line: s.line, x: null, y: null, marker: null, smooth: false,
    invert: false, explosion: 0, dPts: s.dPts, dLbls: null, trends: [], errs: []
  }, extra);
}
const exCat = d => d.cat && d.cat.levels[0] ? d.cat.levels[0].strs : null;
const exVals = d => (d.val || d.size) ? (d.val || d.size).levels[0] : { nums: [], fmt: null };

/* Histogram bins. Width from bin size, bin count or Scott's rule (Excel's
   "automatic"); intervals closed on the right by default, the first one on both. */
function histBins(vals, b, axFmt) {
  const v = vals.filter(x => x != null && isFinite(x)).sort((a, c) => a - c);
  if (!v.length) return { labels: [], counts: [] };
  const n = v.length, under = b.under, over = b.over;
  const start = under != null ? under : v[0], end = over != null ? over : v[n - 1];
  let w;
  if (b.size > 0) w = b.size;
  else if (b.count > 0) w = (end - start) / b.count;
  else {
    const mean = v.reduce((a, c) => a + c, 0) / n;
    const sd = Math.sqrt(v.reduce((a, c) => a + (c - mean) ** 2, 0) / Math.max(n - 1, 1));
    w = 3.5 * sd / Math.cbrt(n);
  }
  if (!(w > 0)) w = (end - start) || 1;
  const nb = b.count > 0 ? Math.round(b.count) : Math.max(1, Math.ceil((end - start) / w - 1e-9));
  const counts = new Array(nb).fill(0); let lowN = 0, highN = 0;
  for (const x of v) {
    if (under != null && x <= under) { lowN++; continue; }
    if (over != null && x > over) { highN++; continue; }
    let j = b.closed === 'l' ? Math.floor((x - start) / w) : Math.ceil((x - start) / w) - 1;
    counts[Math.min(nb - 1, Math.max(0, j))]++;
  }
  const dec = w >= 10 ? 0 : w >= 1 ? 1 : w >= 0.1 ? 2 : 3;
  const f = x => axFmt ? fmtNum(x, axFmt) : fmtGeneral(parseFloat(x.toFixed(dec)));
  const labels = counts.map((_, j) => {
    const a = f(start + j * w), c = f(start + (j + 1) * w);
    if (b.closed === 'l') return `[${a}, ${c}${j === nb - 1 && over == null ? ']' : ')'}`;
    return `${j === 0 && under == null ? '[' : '('}${a}, ${c}]`;
  });
  if (under != null) { labels.unshift('≤' + f(under)); counts.unshift(lowN); }
  if (over != null) { labels.push('>' + f(over)); counts.push(highN); }
  return { labels, counts };
}
/* Quartiles as QUARTILE.EXC / QUARTILE.INC, which is what Excel's box plot uses. */
function quartile(s, p, method) {
  const n = s.length;
  let h = method === 'inclusive' ? (n - 1) * p + 1 : (n + 1) * p;
  h = Math.min(Math.max(h, 1), n);
  const lo = Math.floor(h);
  return s[lo - 1] + (lo < n ? (h - lo) * (s[lo] - s[lo - 1]) : 0);
}
function boxStats(values, method) {
  const v = values.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = quartile(v, 0.25, method), med = quartile(v, 0.5, method), q3 = quartile(v, 0.75, method);
  const iqr = q3 - q1, loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
  const inside = v.filter(x => x >= loF && x <= hiF);
  return {
    q1, med, q3, mean: v.reduce((a, b) => a + b, 0) / v.length,
    lo: Math.min(inside.length ? inside[0] : q1, q1), hi: Math.max(inside.length ? inside[inside.length - 1] : q3, q3),
    out: v.filter(x => x < loF || x > hiF), inner: inside
  };
}
/* Treemap and sunburst hierarchy. Levels come leaf first; a blank parent cell
   means "same as the row above" until a parent above it changes. */
function buildTree(levels, vals, theme) {
  const root = { name: '', children: [], own: 0, total: 0 };
  const L = levels.length, n = Math.max(vals.length, ...levels.map(l => l.strs.length), 0);
  const prev = new Array(L).fill(null);
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v == null || !(v > 0)) continue;
    const path = []; let canFill = true;
    for (let lv = L - 1; lv >= 0; lv--) {
      const s = levels[lv].strs[i];
      if (s != null && s !== '') { if (s !== prev[lv]) canFill = false; path.push(s); }
      else if (canFill && lv > 0 && prev[lv] != null) path.push(prev[lv]);
      else break;
    }
    for (let j = 0; j < L; j++) prev[L - 1 - j] = j < path.length ? path[j] : null;
    if (!path.length) path.push(String(i + 1));
    let node = root;
    for (const name of path) {
      let c = node.children.find(x => x.name === name);
      if (!c) { c = { name, children: [], own: 0, total: 0 }; node.children.push(c); }
      node = c;
    }
    node.own += v;
  }
  const sum = nd => (nd.total = nd.own + nd.children.reduce((a, c) => a + sum(c), 0));
  sum(root);
  const paint = (nd, color, depth) => { nd.color = color; nd.depth = depth; nd.children.forEach(c => paint(c, color, depth + 1)); };
  root.children.forEach((c, i) => paint(c, seriesColor(theme, i), 1));
  root.depth = 0;
  return root;
}

const EX_BUILDERS = {
  waterfall(m, sers, data, axes, theme) {
    m.exType = 'waterfall';
    const s0 = sers[0], d = data[s0.dataId] || {}, V = exVals(d), vals = V.nums;
    const cats = exCat(d) || vals.map((_, i) => String(i + 1));
    const sub = s0.lp.subtotals || new Set();
    const col = { inc: seriesColor(theme, 0), dec: seriesColor(theme, 1), tot: seriesColor(theme, 2) };
    let run = 0; const pts = [], dPts = {};
    vals.forEach((v, i) => {
      if (v == null) { pts.push({ v: null, lo: null, hi: null }); return; }
      let kind;
      if (sub.has(i)) { pts.push({ v, lo: 0, hi: v }); run = v; kind = 'tot'; }
      else { pts.push({ v, lo: run, hi: run + v }); run += v; kind = v < 0 ? 'dec' : 'inc'; }
      const own = s0.dPts[i] || {};
      dPts[i] = { fill: own.fill !== undefined ? own.fill : col[kind], line: own.line, explosion: null, marker: null };
    });
    const ca = exToAxis(axes.find(a => a.kind === 'cat'), 'x', 'cat', 'b'), va = exToAxis(axes.find(a => a.kind === 'val'), 'y', 'val', 'l');
    linkAxes(m, ca, va);
    const vis = s0.lp.vis || {};
    m.groups.push({
      type: 'bar', barDir: 'col', grouping: 'stacked', preset: true, varyColors: false, gapWidth: (ca.gapRatio != null ? ca.gapRatio : 0.5) * 100, overlap: 100,
      axIds: ['x', 'y'], dLbls: s0.dLbls && Object.assign({}, s0.dLbls, { pos: s0.dLbls.pos || 'outEnd' }),
      connectors: vis.connectorLines === false ? null : { color: { c: '#A6A6A6', a: 1 }, w: 0.75 },
      series: [exSer(s0, { x: strData(cats), y: numData(vals, V.fmt), dPts, presetPts: pts })]
    });
    m.legendEntries = [['Increase', col.inc], ['Decrease', col.dec], ['Total', col.tot]].map(([label, fill]) => ({ label, kind: 'swatch', fill }));
  },
  funnel(m, sers, data, axes, theme) {
    m.exType = 'funnel';
    const s0 = sers[0], d = data[s0.dataId] || {}, V = exVals(d);
    const vals = V.nums.map(v => v == null ? null : Math.max(0, v));
    const cats = exCat(d) || vals.map((_, i) => String(i + 1));
    const mx = Math.max(0, ...vals.filter(v => v != null)) || 1;
    const pts = vals.map(v => v == null ? { v: null, lo: null, hi: null } : { v, lo: (mx - v) / 2, hi: (mx - v) / 2 + v });
    const ex = axes.find(a => a.kind === 'cat');
    const ca = exToAxis(ex, 'x', 'cat', 'l', { reversed: true }), va = blankAxis('y', 'val', 'b', { min: 0, max: mx });
    linkAxes(m, ca, va);
    const dl = s0.dLbls && Object.assign({}, s0.dLbls, { pos: s0.dLbls.pos || 'ctr', font: Object.assign({ color: { c: '#FFFFFF', a: 1 } }, s0.dLbls.font) });
    m.groups.push({
      type: 'bar', barDir: 'bar', grouping: 'stacked', preset: true, varyColors: false, gapWidth: (ca.gapRatio != null ? ca.gapRatio : 0.06) * 100, overlap: 100,
      axIds: ['x', 'y'], dLbls: dl, series: [exSer(s0, { x: strData(cats), y: numData(vals, V.fmt), presetPts: pts })]
    });
    m.legendEntries = [{ label: s0.name, kind: 'swatch', fill: s0.fill !== undefined ? s0.fill : seriesColor(theme, 0) }];
  },
  clusteredColumn(m, sers, data, axes, theme) {
    const s0 = sers.find(s => s.layoutId === 'clusteredColumn') || sers[0];
    const pl = sers.find(s => s.layoutId === 'paretoLine' && !s.hidden);
    m.exType = pl ? 'pareto' : 'histogram';
    const d = data[s0.dataId] || {}, V = exVals(d), cats = exCat(d);
    const cx = axes.find(a => a.kind === 'cat'), vxs = axes.filter(a => a.kind === 'val');
    let labels = [], counts = [];
    if (s0.lp.aggregation && cats) {
      const at = new Map();
      V.nums.forEach((v, i) => { const c = cats[i] == null ? '' : cats[i]; if (!at.has(c)) { at.set(c, labels.length); labels.push(c); counts.push(0); } counts[at.get(c)] += v || 0; });
    } else {
      const fmt = cx && cx.numFmt && !cx.numFmt.linked ? cx.numFmt.code : null;
      ({ labels, counts } = histBins(V.nums, s0.lp.binning || { closed: 'r' }, fmt));
    }
    if (pl) {
      const order = counts.map((c, i) => i).sort((a, b) => counts[b] - counts[a]);
      labels = order.map(i => labels[i]); counts = order.map(i => counts[i]);
    }
    const ca = exToAxis(cx, 'x', 'cat', 'b'), va = exToAxis(vxs[0], 'y', 'val', 'l');
    linkAxes(m, ca, va);
    const bars = exSer(s0, { idx: 0, order: 0, x: strData(labels), y: numData(counts, null) });
    if (bars.line === undefined) bars.line = { color: { c: '#FFFFFF', a: 1 }, w: 0.75 };
    m.groups.push({ type: 'bar', barDir: 'col', grouping: 'clustered', varyColors: false, gapWidth: (ca.gapRatio != null ? ca.gapRatio : 0) * 100, overlap: null, axIds: ['x', 'y'], dLbls: s0.dLbls, series: [bars] });
    if (pl) {
      const tot = counts.reduce((a, b) => a + b, 0) || 1; let run = 0;
      const cum = counts.map(c => (run += c) / tot);
      const c2 = blankAxis('x2', 'cat', 'b');
      const v2 = exToAxis(vxs[1], 'y2', 'val', 'r', { crosses: 'max' });
      if (v2.min == null) v2.min = 0; if (v2.max == null) v2.max = 1;
      if (!v2.numFmt || v2.numFmt.linked) v2.numFmt = { code: '0%', linked: false };
      linkAxes(m, c2, v2);
      m.groups.push({ type: 'line', grouping: 'standard', varyColors: false, showMarker: false, axIds: ['x2', 'y2'], dLbls: pl.dLbls, series: [exSer(pl, { idx: 1, order: 1, x: strData(labels), y: numData(cum, '0%') })] });
    }
  },
  boxWhisker(m, sers, data, axes, theme) {
    m.exType = 'boxWhisker';
    const vis = sers.filter(s => !s.hidden);
    const cats = [], at = new Map();
    const per = vis.map(s => {
      const d = data[s.dataId] || {}, V = exVals(d), cs = exCat(d), groups = new Map();
      V.nums.forEach((v, i) => {
        if (v == null) return;
        const c = cs ? (cs[i] == null ? '' : cs[i]) : '';
        if (!at.has(c)) { at.set(c, cats.length); cats.push(c); }
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(v);
      });
      return { groups, fmt: V.fmt };
    });
    if (!cats.length) cats.push('');
    const ca = exToAxis(axes.find(a => a.kind === 'cat'), 'x', 'cat', 'b'), va = exToAxis(axes.find(a => a.kind === 'val'), 'y', 'val', 'l');
    linkAxes(m, ca, va);
    m.groups.push({
      type: 'box', varyColors: false, gapWidth: (ca.gapRatio != null ? ca.gapRatio : 1) * 100, axIds: ['x', 'y'], cats, dLbls: null,
      series: vis.map((s, si) => exSer(s, {
        idx: si, order: si, y: numData([], per[si].fmt),
        stats: cats.map(c => per[si].groups.has(c) ? boxStats(per[si].groups.get(c), s.lp.quartile || 'exclusive') : null),
        vis: Object.assign({ meanLine: false, meanMarker: true, nonoutliers: false, outliers: true }, s.lp.vis)
      }))
    });
  },
  treemap(m, sers, data, axes, theme) { exTree(m, sers, data, theme, 'treemap'); },
  sunburst(m, sers, data, axes, theme) { exTree(m, sers, data, theme, 'sunburst'); }
};
function exTree(m, sers, data, theme, type) {
  const s0 = sers[0], d = data[s0.dataId] || {}, V = exVals(d);
  m.exType = type;
  m.tree = buildTree(d.cat ? d.cat.levels : [], V.nums, theme);
  m.groups.push({ type, varyColors: false, dLbls: s0.dLbls, parentLabel: s0.lp.parentLabel || 'overlapping', sizeFmt: V.fmt, series: [exSer(s0, {})] });
  m.legendEntries = m.tree.children.map(c => ({ label: c.name, kind: 'swatch', fill: c.color }));
}

async function parseChartEx(doc, theme, R) {
  await R.prepare(doc);
  const root = doc.documentElement, chart = kid(root, 'chart'), pa = kid(chart, 'plotArea'), region = kid(pa, 'plotAreaRegion');
  const data = {};
  for (const d of kids(kid(root, 'chartData'), 'data')) {
    const o = {};
    for (const dim of Array.from(d.children)) if (dim.localName === 'strDim' || dim.localName === 'numDim') { const pd = parseExDim(dim, R); if (!o[pd.type]) o[pd.type] = pd; }
    data[d.getAttribute('id')] = o;
  }
  const sers = kids(region, 'series').map((e, i) => parseExSeries(e, theme, R, i));
  const axes = kids(pa, 'axis').map(e => parseExAxis(e, theme, R));
  const m = { theme, groups: [], axes: {}, unsupported: null, is3D: false, autoTitleDeleted: true, blanks: 'gap', ex: true };
  m.baseFont = Object.assign({ size: 9, color: { c: '#595959', a: 1 } }, exFont(kid(root, 'txPr'), theme));
  Object.assign(m, { chartFill: fillFrom(kid(root, 'spPr'), theme), chartLine: lineFrom(kid(root, 'spPr'), theme) });
  m.plotFill = fillFrom(kid(region, 'spPr'), theme) || fillFrom(kid(pa, 'spPr'), theme);
  m.plotLine = lineFrom(kid(region, 'spPr'), theme);
  m.title = parseExTitle(kid(chart, 'title'), theme, R);
  const lg = kid(chart, 'legend');
  if (lg) {
    m.legend = { pos: { t: 't', b: 'b', l: 'l', r: 'r' }[lg.getAttribute('pos')] || 't', layout: null, overlay: lg.getAttribute('overlay') === '1', font: exFont(kid(lg, 'txPr'), theme), hidden: new Set() };
    Object.assign(m.legend, shapeProps(kid(lg, 'spPr'), theme));
  }
  const main = sers.find(s => !s.hidden) || sers[0];
  if (!main) { m.unsupported = 'Empty'; return m; }
  const build = EX_BUILDERS[main.layoutId === 'paretoLine' ? 'clusteredColumn' : main.layoutId];
  if (!build) { m.unsupported = CHARTEX_NAMES[main.layoutId] || 'This chart type'; return m; }
  build(m, sers, data, axes, theme);
  if (!m.groups.length) m.unsupported = 'Empty';
  return m;
}

/* What Excel would call the chart, for the card badge. */
function chartKind(m) {
  if (!m) return '';
  const EX = { waterfall: 'Waterfall', funnel: 'Funnel', histogram: 'Histogram', pareto: 'Pareto', boxWhisker: 'Box and whisker', treemap: 'Treemap', sunburst: 'Sunburst' };
  if (m.exType) return EX[m.exType] || '';
  const names = [];
  for (const g of m.groups) {
    const st = g.grouping === 'percentStacked' ? '100% stacked ' : g.grouping === 'stacked' ? 'Stacked ' : '';
    let n = {
      bar: st + (g.barDir === 'bar' ? 'bar' : 'column'), line: g.stock ? 'Stock' : st + 'line', area: st + 'area', scatter: 'Scatter', bubble: 'Bubble',
      radar: g.radarStyle === 'filled' ? 'Filled radar' : 'Radar', doughnut: 'Doughnut',
      pie: g.ofPie ? (g.ofPie.type === 'bar' ? 'Bar of pie' : 'Pie of pie') : 'Pie'
    }[g.type] || '';
    n = n.charAt(0).toUpperCase() + n.slice(1);
    if (n && !names.includes(n)) names.push(n);
  }
  return names.length > 2 ? 'Combination' : names.join(' + ');
}

async function loadWorkbook(buf, JSZipLib) {
  const zip = await JSZipLib.loadAsync(buf);
  const rootRels = await readRels(zip, '');
  let wbPath = 'xl/workbook.xml';
  for (const r of Object.values(rootRels)) if (/\/officeDocument$/.test(r.type)) wbPath = r.target;
  const wbText = await readText(zip, wbPath);
  if (!wbText) throw new Error('not-xlsx');
  const wbDoc = parseXml(wbText);
  const wbRels = await readRels(zip, wbPath);
  let theme = defaultTheme();
  const themeRel = Object.values(wbRels).find(r => /\/theme$/.test(r.type));
  if (themeRel) { const t = await readText(zip, themeRel.target); if (t) theme = parseTheme(parseXml(t)); }
  const sheets = [], sheetPaths = {};
  for (const s of descs(wbDoc.documentElement, 'sheet')) {
    const rel = wbRels[rid(s)]; if (!rel) continue;
    const kind = /chartsheet$/.test(rel.type) ? 'chartsheet' : /worksheet$/.test(rel.type) ? 'worksheet' : 'other';
    sheets.push({ name: s.getAttribute('name'), path: rel.target, kind });
    sheetPaths[s.getAttribute('name')] = rel.target;
  }
  const R = await makeResolver(zip, wbRels, sheetPaths);
  const charts = [];
  for (const sh of sheets) {
    if (sh.kind === 'other') continue;
    const sRels = await readRels(zip, sh.path);
    const dRel = Object.values(sRels).find(r => /\/drawing$/.test(r.type));
    if (!dRel) continue;
    const dText = await readText(zip, dRel.target); if (!dText) continue;
    const dDoc = parseXml(dText);
    const dRels = await readRels(zip, dRel.target);
    let geom = null, n = 0;
    for (const an of Array.from(dDoc.documentElement.children).filter(e => /Anchor$/.test(e.localName))) {
      const refs = Array.from(an.getElementsByTagName('*')).filter(e => e.localName === 'chart' && (e.namespaceURI === NS_C || e.namespaceURI === NS_CX) && rid(e));
      if (!refs.length) continue;
      if (!geom && an.localName === 'twoCellAnchor') geom = await sheetGeometry(zip, sh.path);
      const size = anchorSize(an, geom);
      for (const ref of refs) {
        n++;
        let frame = ref; while (frame && frame.localName !== 'graphicFrame' && frame !== an) frame = frame.parentNode;
        const cnv = descs(frame, 'cNvPr')[0];
        const rel = dRels[rid(ref)];
        charts.push({ sheet: sh.name, sheetKind: sh.kind, name: (cnv && cnv.getAttribute('name')) || ('Chart ' + n), path: rel && rel.target, sizeEmu: size, chartex: ref.namespaceURI === NS_CX });
      }
    }
  }
  for (const ch of charts) {
    try {
      const text = ch.path && await readText(zip, ch.path);
      if (!text) { ch.error = 'missing'; continue; }
      const doc = parseXml(text);
      ch.model = ch.chartex ? await parseChartEx(doc, theme, R) : await parseChart(doc, theme, R);
      if (ch.model.unsupported) { ch.error = 'unsupported'; ch.typeLabel = ch.model.unsupported === 'Empty' ? 'An empty chart' : ch.model.unsupported; }
    } catch (e) { ch.error = 'parse'; ch.errorMsg = String(e && e.message || e); }
  }
  return { charts, theme };
}

/* ===== Number formatting ===== */
const NUMLOC = { decimal: '.', group: ',' };
function locNum(s) { return NUMLOC.decimal === '.' ? s : s.replace(/[.,]/g, c => (c === '.' ? NUMLOC.decimal : NUMLOC.group)); }
function expStr(m, e) { return m + 'E' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0'); }
function fmtGeneral(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e11 || a < 1e-9) {
    const [m, e] = v.toExponential(5).split('e');
    return locNum(expStr(m.replace(/\.?0+$/, ''), +e));
  }
  let s = String(parseFloat(v.toPrecision(10)));
  if (/e/i.test(s)) s = v.toFixed(12).replace(/\.?0+$/, '');
  return locNum(s);
}
function splitSections(code) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') q = !q;
    if (ch === '\\' && !q) { cur += ch + (code[i + 1] || ''); i++; continue; }
    if (ch === ';' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtDate(v, s) {
  const d = new Date(Math.round((v - 25569) * 86400000));
  const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), se = d.getUTCSeconds(), wd = d.getUTCDay();
  const ampm = /AM\/PM/i.test(s);
  let lastHour = false;
  const p2 = n => String(n).padStart(2, '0');
  const toks = s.match(/yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|./gi) || [];
  return toks.map((t, i) => {
    const lt = t.toLowerCase();
    const nextIsSec = () => toks.slice(i + 1).some(x => /^s+$/i.test(x)) && !toks.slice(i + 1).some(x => /^[dy]+$/i.test(x));
    switch (lt) {
      case 'yyyy': lastHour = false; return String(Y);
      case 'yy': lastHour = false; return p2(Y % 100);
      case 'mmmmm': return MONTHS[Mo][0];
      case 'mmmm': return MONTHS[Mo];
      case 'mmm': return MONTHS[Mo].slice(0, 3);
      case 'mm': case 'm': { const minute = lastHour || nextIsSec(); lastHour = false; const n = minute ? mi : Mo + 1; return lt === 'mm' ? p2(n) : String(n); }
      case 'dddd': return DAYS[wd];
      case 'ddd': return DAYS[wd].slice(0, 3);
      case 'dd': lastHour = false; return p2(D);
      case 'd': lastHour = false; return String(D);
      case 'hh': case 'h': { lastHour = true; let hh = h; if (ampm) hh = h % 12 || 12; return lt === 'hh' ? p2(hh) : String(hh); }
      case 'ss': return p2(se);
      case 's': return String(se);
      case 'am/pm': return h < 12 ? 'AM' : 'PM';
      default: return t;
    }
  }).join('');
}
function fmtNum(v, code) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  if (!code || /^\s*general\s*$/i.test(code)) return fmtGeneral(v);
  const secs = splitSections(code);
  let sec = secs[0], x = v, abs = false;
  if (secs.length >= 2 && v < 0) { sec = secs[1]; x = -v; abs = true; }
  else if (secs.length >= 3 && v === 0) sec = secs[2];
  const lits = [];
  const keep = t => { lits.push(t); return String.fromCharCode(0xE000 + lits.length - 1); };
  let s = sec
    .replace(/\[\$([^\]\-]*)(-[^\]]*)?\]/g, (_, c) => keep(c))
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"([^"]*)"/g, (_, t) => keep(t))
    .replace(/\\(.)/g, (_, t) => keep(t))
    .replace(/_./g, ' ').replace(/\*./g, '');
  const restore = t => t.replace(/[\uE000-\uF8FF]/g, c => lits[c.charCodeAt(0) - 0xE000]);
  if (/^\s*general\s*$/i.test(restore(s).trim()) || /general/i.test(s)) return (v < 0 && abs ? '-' : '') + restore(s.replace(/general/i, fmtGeneral(x)));
  if (s.trim() === '@') return fmtGeneral(v);
  const bare = s.replace(/[\uE000-\uF8FF]/g, '');
  if (/[ymdhs]/i.test(bare) && !/[0#?]/.test(bare)) return restore(fmtDate(v, s));
  const pc = (bare.match(/%/g) || []).length;
  x *= Math.pow(100, pc);
  const m = /[0#?][0#?,]*(\.[0#?]*)?(E[+-][0#]+)?|\.[0#?]+(E[+-][0#]+)?/i.exec(s);
  if (!m) return restore(s);
  const pat = m[0];
  const ep = /E[+-]([0#]+)/i.exec(pat);
  const dp = /\.([0#?]*)/.exec(pat);
  const dec = dp ? dp[1].length : 0;
  const minDec = dp ? (dp[1].match(/0/g) || []).length : 0;
  let num, neg = x < 0;
  if (ep) {
    let [mant, e] = Math.abs(x).toExponential(dec).split('e');
    if (dec > minDec) mant = mant.replace(new RegExp('0{0,' + (dec - minDec) + '}$'), '');
    const en = +e;
    num = mant + 'E' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(ep[1].length, '0');
  } else {
    let intPat = pat.split('.')[0];
    const tc = /,+$/.exec(intPat);
    if (tc) { x /= Math.pow(1000, tc[0].length); intPat = intPat.slice(0, -tc[0].length); }
    const thousands = /,/.test(intPat);
    let str = Math.abs(x).toFixed(dec);
    if (dec > minDec) str = str.replace(new RegExp('0{0,' + (dec - minDec) + '}$'), '');
    let [ip, fp] = str.split('.');
    const minInt = (intPat.match(/0/g) || []).length;
    if (ip === '0' && minInt === 0) ip = '';
    while (ip.length < minInt) ip = '0' + ip;
    if (thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    num = ip + (fp !== undefined ? '.' + fp : (dp ? '.' : ''));
    if (Number(str) === 0) neg = false;
  }
  num = locNum(num);
  const out = s.slice(0, m.index) + num + s.slice(m.index + pat.length);
  return (neg && !abs ? '-' : '') + restore(out);
}
function isDateFmt(code) {
  if (!code) return false;
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymd]/i.test(bare) && !/[0#?]/.test(bare);
}

/* ===== Display list ===== */
const r2 = n => Math.round(n * 100) / 100;
function rectD(x, y, w, h) { return `M${r2(x)} ${r2(y)}H${r2(x + w)}V${r2(y + h)}H${r2(x)}Z`; }
function lineD(pts) { return pts.length ? 'M' + pts.map(p => r2(p[0]) + ' ' + r2(p[1])).join('L') : ''; }
function smoothD(p) {
  if (p.length < 3) return lineD(p);
  let d = `M${r2(p[0][0])} ${r2(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d;
}
function circleD(cx, cy, r) { return `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`; }
class DL {
  constructor() { this.items = []; }
  path(d, st) { if (d && st && (st.fill || st.stroke)) this.items.push(Object.assign({ t: 'path', d }, st)); }
  text(x, y, rot, items) { if (items.length) this.items.push({ t: 'text', x, y, rot: rot || 0, items }); }
  clip(r) { this.items.push({ t: 'clip', x: r.x, y: r.y, w: r.w, h: r.h }); }
  unclip() { this.items.push({ t: 'unclip' }); }
}
const DASH = { solid: null, dot: [1, 1], sysDot: [1, 1], dash: [4, 3], sysDash: [3, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };
function strokeOf(line, dflt, k, cap) {
  if (line && line.none) return null;
  if (!line && !dflt) return null;
  const color = (line && line.color) || (dflt && dflt.color);
  if (!color) return null;
  const w = Math.max(((line && line.w != null) ? line.w : (dflt && dflt.w != null ? dflt.w : 0.75)) * k, 0.25 * k);
  const dn = (line && line.dash) || (dflt && dflt.dash) || 'solid';
  const pat = DASH[dn];
  const capS = line && line.cap ? (line.cap === 'rnd' ? 'round' : line.cap === 'sq' ? 'square' : 'butt') : (cap || 'butt');
  return { stroke: color, sw: w, dash: pat ? pat.map(v => v * Math.max(w, 0.75 * k)) : null, cap: capS };
}

/* ===== Fonts and text blocks ===== */
const TEXT_GREY = { c: '#404040', a: 1 };
const WHITE = { c: '#FFFFFF', a: 1 };
function mkFont(...layers) {
  const f = { size: 10, bold: false, italic: false, color: TEXT_GREY, family: 'Calibri' };
  for (const l of layers) if (l) for (const key of ['size', 'bold', 'italic', 'color', 'family', 'baseline']) if (l[key] !== undefined) f[key] = l[key];
  return f;
}

/* ===== Statistics for trendlines ===== */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-300) return null;
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
function polyFit(xs, ys, order, c0) {
  const fixed = c0 != null;
  const start = fixed ? 1 : 0, m = order + 1 - start;
  const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i] - (fixed ? c0 : 0);
    for (let r = 0; r < m; r++) {
      const xr = Math.pow(xs[i], r + start); b[r] += xr * y;
      for (let c = 0; c < m; c++) A[r][c] += xr * Math.pow(xs[i], c + start);
    }
  }
  const sol = solve(A, b); if (!sol) return null;
  return fixed ? [c0, ...sol] : sol;
}
function rsq(ys, fit) {
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssr = 0, sst = 0; ys.forEach((y, i) => { ssr += (y - fit[i]) ** 2; sst += (y - mean) ** 2; });
  return sst > 0 ? 1 - ssr / sst : 1;
}
function fitTrend(t, X, Y) {
  let xs = [], ys = [];
  X.forEach((x, i) => { const y = Y[i]; if (x == null || y == null || !isFinite(x) || !isFinite(y)) return; xs.push(x); ys.push(y); });
  const T = t.type;
  if (T === 'movingAvg') {
    const p = Math.max(2, Math.round(t.period)); const pts = [];
    for (let i = p - 1; i < xs.length; i++) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += ys[j]; pts.push([xs[i], s / p]); }
    return pts.length ? { pts } : null;
  }
  if (T === 'exp' || T === 'power') { const keep = xs.map((x, i) => ys[i] > 0 && (T === 'exp' || x > 0)); xs = xs.filter((_, i) => keep[i]); ys = ys.filter((_, i) => keep[i]); }
  if (T === 'log') { const keep = xs.map(x => x > 0); xs = xs.filter((_, i) => keep[i]); ys = ys.filter((_, i) => keep[i]); }
  if (xs.length < 2) return null;
  let f, c, r2v, kind = T;
  if (T === 'poly') {
    const ord = Math.min(6, Math.max(2, Math.round(t.order)));
    c = polyFit(xs, ys, Math.min(ord, xs.length - 1), t.intercept); if (!c) return null;
    f = x => c.reduce((s, ci, i) => s + ci * Math.pow(x, i), 0);
    r2v = rsq(ys, xs.map(f));
  } else if (T === 'exp') {
    const ly = ys.map(Math.log);
    c = polyFit(xs, ly, 1, t.intercept != null && t.intercept > 0 ? Math.log(t.intercept) : null); if (!c) return null;
    const a = Math.exp(c[0]), b = c[1]; c = [a, b];
    f = x => a * Math.exp(b * x); r2v = rsq(ly, xs.map(x => Math.log(f(x))));
  } else if (T === 'log') {
    const lx = xs.map(Math.log); c = polyFit(lx, ys, 1, null); if (!c) return null;
    f = x => c[0] + c[1] * Math.log(x); r2v = rsq(ys, xs.map(f));
  } else if (T === 'power') {
    const lx = xs.map(Math.log), ly = ys.map(Math.log);
    c = polyFit(lx, ly, 1, null); if (!c) return null;
    const a = Math.exp(c[0]), b = c[1]; c = [a, b];
    f = x => a * Math.pow(x, b); r2v = rsq(ly, xs.map(x => Math.log(f(x))));
  } else {
    kind = 'linear'; c = polyFit(xs, ys, 1, t.intercept); if (!c) return null;
    f = x => c[0] + c[1] * x; r2v = rsq(ys, xs.map(f));
  }
  return { f, c, r2: r2v, kind, xmin: Math.min(...xs) - (t.backward || 0), xmax: Math.max(...xs) + (t.forward || 0) };
}
function coefStr(v, fmt) {
  if (fmt && !/^\s*general\s*$/i.test(fmt)) return fmtNum(v, fmt);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) { const [m, e] = v.toExponential(4).split('e'); return locNum(expStr(m.replace(/\.?0+$/, ''), +e)); }
  return locNum(String(parseFloat(v.toPrecision(5))));
}
function eqRuns(fit, fmt) {
  const R = [], add = (text, sup) => R.push({ text, sup: !!sup });
  const signed = (v, first) => first ? coefStr(v, fmt) : (v < 0 ? ' - ' : ' + ') + coefStr(Math.abs(v), fmt);
  const c = fit.c;
  add('y = ');
  if (fit.kind === 'linear') { add(coefStr(c[1], fmt) + 'x'); if (c[0] !== 0) add(signed(c[0])); }
  else if (fit.kind === 'poly') {
    let first = true;
    for (let i = c.length - 1; i >= 0; i--) {
      if (c[i] === 0 && i > 0) continue;
      add(signed(c[i], first) + (i > 0 ? 'x' : '')); if (i > 1) add(String(i), true); first = false;
    }
  } else if (fit.kind === 'exp') { add(coefStr(c[0], fmt) + 'e'); add(coefStr(c[1], fmt) + 'x', true); }
  else if (fit.kind === 'log') { add(coefStr(c[1], fmt) + 'ln(x)'); if (c[0] !== 0) add(signed(c[0])); }
  else if (fit.kind === 'power') { add(coefStr(c[0], fmt) + 'x'); add(coefStr(c[1], fmt), true); }
  return R;
}
const TREND_NAMES = { linear: 'Linear', exp: 'Expon.', log: 'Log.', poly: 'Poly.', power: 'Power', movingAvg: 'Mov. Avg.' };

/* ===== Value scales ===== */
function niceStep(range, maxT) {
  const raw = range / Math.max(maxT, 1); const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const f of [1, 2, 5, 10]) if (f * mag >= raw * 0.999999) return f * mag;
  return 10 * mag;
}
const clean = v => parseFloat(v.toPrecision(12));
/* Excel-like automatic axis range for a data domain {lo, hi} and an axis's fixed bounds. */
function scaleRange(d, a, maxT, forceStep) {
  d = d || { lo: 0, hi: 1 };
  let lo = isFinite(d.lo) ? d.lo : 0, hi = isFinite(d.hi) ? d.hi : 1;
  if (a.pctDefault && a.min == null && a.max == null && lo >= 0) { lo = 0; hi = 1; }
  if (a.logBase) {
    const b = a.logBase; const L = v => Math.log(v) / Math.log(b);
    if (!(lo > 0)) lo = 1; if (!(hi > 0)) hi = lo * b;
    let min = a.min != null && a.min > 0 ? a.min : Math.pow(b, Math.floor(L(lo) + 1e-9));
    let max = a.max != null && a.max > 0 ? a.max : Math.pow(b, Math.ceil(L(hi) - 1e-9));
    if (max <= min) max = min * b;
    const ticks = []; for (let e = Math.ceil(L(min) - 1e-9); e <= Math.floor(L(max) + 1e-9); e++) ticks.push(clean(Math.pow(b, e)));
    if (!ticks.length || ticks[0] > min * 1.000001) ticks.unshift(min);
    const minor = [];
    if (b === 10) for (let e = Math.floor(L(min)); e < Math.ceil(L(max)); e++) for (let f = 2; f < 10; f++) { const v = f * Math.pow(10, e); if (v > min && v < max) minor.push(v); }
    return { min, max, ticks, minor, log: b };
  }
  const fmin = a.min != null, fmax = a.max != null;
  if (fmin) lo = a.min; if (fmax) hi = a.max;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) { if (lo === 0) hi = 1; else if (lo > 0) { if (!fmin) lo = 0; else hi = lo * 2; } else { if (!fmax) hi = 0; else lo = hi * 2; } }
  let pinLo = fmin, pinHi = fmax;
  if (!fmin && lo >= 0 && lo <= hi * 5 / 6) { lo = 0; pinLo = true; }
  if (!fmax && hi <= 0 && hi >= lo * 5 / 6) { hi = 0; pinHi = true; }
  const ext = (hi - lo) * 0.05;
  const span = (hi + (pinHi ? 0 : ext)) - (lo - (pinLo ? 0 : ext));
  const step = a.majorUnit > 0 ? a.majorUnit : forceStep || niceStep(span || 1, maxT);
  const min = fmin ? lo : pinLo ? lo : Math.floor(clean((lo - ext) / step)) * step;
  let max = fmax ? hi : pinHi ? hi : Math.ceil(clean((hi + ext) / step)) * step;
  if (max <= min) max = min + step;
  const ticks = []; for (let i = 0; i <= 1000; i++) { const v = clean(min + i * step); if (v > max + step * 1e-9) break; ticks.push(v); }
  const mu = a.minorUnit > 0 ? a.minorUnit : step / 5;
  const minor = []; for (let i = 1; i <= 5000; i++) { const v = clean(min + i * mu); if (v >= max) break; minor.push(v); }
  return { min: clean(min), max: clean(max), ticks, minor, step };
}

/* ===== Chart renderer ===== */
function renderChart(m, W, H, opt) {
  const k = opt.k || 1, M = opt.measure, theme = m.theme;
  const dl = new DL();
  const base = mkFont({ size: 10, color: TEXT_GREY, family: theme.minorFont }, m.baseFont);
  const SZ = f => f.size * k;
  const runSize = r => SZ(r.f) * (r.f.baseline ? 0.67 : 1);

  function block(lines, bf) {
    const out = { lines: [], w: 0, h: 0 };
    for (const ln of lines) {
      const runs = ln.map(r => { const f = mkFont(bf, r.f); const rr = { text: r.text, f }; rr.size = runSize(rr); rr.w = M(r.text, f, rr.size); return rr; });
      const size = runs.length ? Math.max(...runs.map(r => SZ(r.f))) : SZ(bf);
      const w = runs.reduce((a, r) => a + r.w, 0), h = size * 1.2;
      out.lines.push({ runs, w, h, size }); out.w = Math.max(out.w, w); out.h += h;
    }
    return out;
  }
  const simple = (text, f) => block([[{ text: String(text), f: {} }]], f);
  function drawBlock(b, cx, cy, rot) {
    const lines = []; let y = -b.h / 2;
    for (const ln of b.lines) {
      lines.push({ y: y + ln.size * 0.92, w: ln.w, runs: ln.runs.map(r => ({ text: r.text, f: r.f, size: r.size, w: r.w, shift: r.f.baseline ? -r.f.baseline * SZ(r.f) * 1.1 : 0 })) });
      y += ln.h;
    }
    dl.text(cx, cy, rot, lines);
  }
  const rotBox = (b, rot) => { const a = Math.abs(rot) * Math.PI / 180; return { w: b.w * Math.cos(a) + b.h * Math.sin(a), h: b.w * Math.sin(a) + b.h * Math.cos(a) }; };

  /* Background */
  if (!opt.transparent) {
    const bg = m.chartFill === undefined ? { c: '#ffffff', a: 1 } : m.chartFill;
    if (bg) dl.path(rectD(0, 0, W, H), { fill: bg });
  }
  const border = strokeOf(m.chartLine, null, k);
  if (border) dl.path(rectD(border.sw / 2, border.sw / 2, W - border.sw, H - border.sw), border);

  const pad = 7 * k;
  const C = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad };
  const allSeries = [];
  for (const g of m.groups) { g.sers = g.series.slice().sort((a, b) => a.order - b.order); for (const s of g.sers) allSeries.push({ g, s }); }
  const pieOnly = m.groups.every(g => g.type === 'pie' || g.type === 'doughnut');
  /* Radar, treemap and sunburst have no x/y axes; each draws its own plot. */
  const own = m.groups[0] && ['radar', 'treemap', 'sunburst'].includes(m.groups[0].type) ? m.groups[0].type : null;

  /* Default series styles */
  const varyPts = g => g.varyColors && !['radar', 'box', 'treemap', 'sunburst'].includes(g.type) && (g.type === 'pie' || g.type === 'doughnut' || allSeries.length === 1);
  function fillFor(g, s, i) {
    const d = i != null && s.dPts[i];
    if (d && d.fill !== undefined) return d.fill;
    if (i != null && varyPts(g)) return seriesColor(theme, i);
    if (s.fill !== undefined) return s.fill;
    return seriesColor(theme, s.idx);
  }
  function lineColorFor(s) { return (s.line && s.line.color) || seriesColor(theme, s.idx); }
  const AUTO_MARKERS = ['diamond', 'square', 'triangle', 'x', 'star', 'circle', 'plus', 'dash', 'dot'];
  function markerFor(g, s, i) {
    const pm = i != null && s.dPts[i] && s.dPts[i].marker;
    const sm = s.marker;
    let symbol = (pm && pm.symbol) || (sm && sm.symbol) || null;
    if (g.type === 'line' && !g.showMarker) return null;
    if (g.type === 'bubble' || g.type === 'box' || (g.type === 'radar' && g.radarStyle === 'filled')) return null;
    if (!symbol) {
      if (g.type === 'scatter' && (g.scatterStyle === 'line' || g.scatterStyle === 'smooth' || g.scatterStyle === 'none')) return null;
      // Stock series and plain radar lines show a marker only when one is set.
      if (g.stock || (g.type === 'radar' && g.radarStyle === 'standard')) return null;
      symbol = 'auto';
    }
    if (symbol === 'none') return null;
    if (symbol === 'auto') symbol = AUTO_MARKERS[s.idx % AUTO_MARKERS.length];
    const size = ((pm && pm.size) || (sm && sm.size) || 5) * k;
    const base = lineColorFor(s);
    let fill = pm && pm.fill !== undefined ? pm.fill : sm && sm.fill !== undefined ? sm.fill : base;
    let line = (pm && pm.line) || (sm && sm.line);
    const st = strokeOf(line, { color: base, w: 0.75 }, k);
    if (st) st.dash = null;
    return { symbol, size, fill, st };
  }
  function drawMarker(mk, x, y) {
    const r = mk.size / 2; let d, open = false;
    switch (mk.symbol) {
      case 'circle': d = circleD(x, y, r); break;
      case 'square': d = rectD(x - r, y - r, 2 * r, 2 * r); break;
      case 'diamond': d = `M${r2(x)} ${r2(y - r)}L${r2(x + r)} ${r2(y)}L${r2(x)} ${r2(y + r)}L${r2(x - r)} ${r2(y)}Z`; break;
      case 'triangle': d = `M${r2(x)} ${r2(y - r)}L${r2(x + r)} ${r2(y + r)}L${r2(x - r)} ${r2(y + r)}Z`; break;
      case 'x': d = `M${r2(x - r)} ${r2(y - r)}L${r2(x + r)} ${r2(y + r)}M${r2(x - r)} ${r2(y + r)}L${r2(x + r)} ${r2(y - r)}`; open = true; break;
      case 'plus': d = `M${r2(x - r)} ${r2(y)}L${r2(x + r)} ${r2(y)}M${r2(x)} ${r2(y - r)}L${r2(x)} ${r2(y + r)}`; open = true; break;
      case 'star': d = `M${r2(x - r)} ${r2(y - r)}L${r2(x + r)} ${r2(y + r)}M${r2(x - r)} ${r2(y + r)}L${r2(x + r)} ${r2(y - r)}M${r2(x)} ${r2(y - r)}L${r2(x)} ${r2(y + r)}`; open = true; break;
      case 'dash': d = rectD(x - r, y - r / 4, 2 * r, r / 2); break;
      case 'dot': d = rectD(x - r / 2, y - r / 4, r, r / 2); break;
      default: d = circleD(x, y, r);
    }
    if (open) { const c = (mk.st && mk.st.stroke) || mk.fill; if (c) dl.path(d, { stroke: c, sw: Math.max(1 * k, mk.st ? mk.st.sw : 0), cap: 'butt' }); }
    else dl.path(d, Object.assign({ fill: mk.fill || null }, mk.st || {}));
  }
  function seriesLine(g, s) {
    if (g.type === 'scatter' && (g.scatterStyle === 'marker' || g.scatterStyle === 'none') && !(s.line && s.line.color)) return null;
    if (g.stock && !(s.line && s.line.color)) return null;
    return strokeOf(s.line, { color: lineColorFor(s), w: g.type === 'scatter' ? 1.5 : 2.25 }, k, 'round');
  }

  /* Title */
  const first = allSeries[0] && allSeries[0].s;
  let titleLines = null, titleSpec = m.title;
  if (m.title) titleLines = (m.title.lines && m.title.lines.length) ? m.title.lines : [[{ text: allSeries.length === 1 ? first.name : 'Chart Title', f: {} }]];
  else if (!m.autoTitleDeleted && allSeries.length === 1) titleLines = [[{ text: first.name, f: {} }]];
  let titleDraw = null;
  if (titleLines) {
    const tf = mkFont(base, { size: 14, bold: true }, titleSpec && titleSpec.font);
    const tb = block(titleLines, tf);
    const lay = titleSpec && titleSpec.layout;
    if (lay && lay.x != null && lay.y != null) {
      const x0 = lay.xMode === 'edge' ? lay.x * W : W / 2 - tb.w / 2 + lay.x * W;
      const y0 = lay.yMode === 'edge' ? lay.y * H : pad + lay.y * H;
      titleDraw = { b: tb, cx: x0 + tb.w / 2, cy: y0 + tb.h / 2 };
    } else {
      titleDraw = { b: tb, cx: W / 2, cy: C.y + tb.h / 2 };
      if (!(titleSpec && titleSpec.overlay)) { C.y += tb.h + 5 * k; C.h -= tb.h + 5 * k; }
    }
  }

  /* Legend */
  let legendDraw = null;
  if (m.legend) {
    const L = m.legend;
    const lf = mkFont(base, L.font);
    const entries = [];
    const kindOf = g => g.type === 'line' || g.type === 'scatter' || (g.type === 'radar' && g.radarStyle !== 'filled') ? 'line' : g.type === 'bubble' ? 'bubble' : 'box';
    if (m.legendEntries) {
      for (const e of m.legendEntries) entries.push(Object.assign({}, e));
    } else if (allSeries.length === 1 && varyPts(allSeries[0].g) || pieOnly && m.groups[0] && varyPts(m.groups[0])) {
      const { g, s } = allSeries[0];
      const n = Math.max(s.y ? s.y.strs.length : 0, s.x ? s.x.strs.length : 0);
      const labels = catLabels(s, n, null);
      for (let i = 0; i < n; i++) entries.push({ label: labels[i], kind: kindOf(g), g, s, i });
    } else {
      for (const { g, s } of allSeries) entries.push({ label: s.name, kind: kindOf(g), g, s });
      for (const { g, s } of allSeries) for (const t of s.trends) entries.push({ label: t.name || `${TREND_NAMES[t.type] || 'Trend'} (${s.name})`, kind: 'trend', g, s, t });
    }
    const vis = entries.filter((e, i) => !L.hidden.has(i));
    const fsz = SZ(lf), rowH = fsz * 1.45;
    const swatchW = e => e.kind === 'box' || e.kind === 'swatch' || e.kind === 'bubble' ? fsz * 0.7 : fsz * 2;
    for (const e of vis) { e.b = simple(e.label, lf); e.w = swatchW(e) + 4 * k + e.b.w; }
    const vertical = ['r', 'l', 'tr'].includes(L.pos);
    let lw, lh, rows = [];
    if (vertical) {
      lw = Math.min(Math.max(0, ...vis.map(e => e.w)), C.w * 0.45);
      const maxRows = Math.max(1, Math.floor((C.h) / rowH));
      rows = vis.slice(0, maxRows).map(e => [e]); lh = rows.length * rowH;
    } else {
      const gapX = 9 * k; let row = [], rw = 0;
      for (const e of vis) { if (row.length && rw + gapX + e.w > C.w) { rows.push(row); row = []; rw = 0; } rw += (row.length ? gapX : 0) + e.w; row.push(e); }
      if (row.length) rows.push(row);
      lw = Math.max(0, ...rows.map(r => r.reduce((a, e, i) => a + e.w + (i ? gapX : 0), 0))); lh = rows.length * rowH;
    }
    const lpad = (L.line && !L.line.none) || L.fill ? 4 * k : 0;
    lw += 2 * lpad; lh += 2 * lpad;
    let lx, ly;
    const lay = L.layout;
    if (lay && lay.xMode === 'edge' && lay.x != null && lay.y != null) {
      lx = lay.x * W; ly = lay.y * H;
      if (lay.w != null) lw = Math.max(lw, lay.w * W);
      if (lay.h != null) lh = Math.max(lh, lay.h * H);
    } else {
      const gap = 9 * k;
      if (L.pos === 'b') { lx = C.x + (C.w - lw) / 2; ly = C.y + C.h - lh; if (!L.overlay) C.h -= lh + 5 * k; }
      else if (L.pos === 't') { lx = C.x + (C.w - lw) / 2; ly = C.y; if (!L.overlay) { C.y += lh + 5 * k; C.h -= lh + 5 * k; } }
      else if (L.pos === 'l') { lx = C.x; ly = C.y + (C.h - lh) / 2; if (!L.overlay) { C.x += lw + gap; C.w -= lw + gap; } }
      else if (L.pos === 'tr') { lx = C.x + C.w - lw; ly = C.y; if (!L.overlay) C.w -= lw + gap; }
      else { lx = C.x + C.w - lw; ly = C.y + (C.h - lh) / 2; if (!L.overlay) C.w -= lw + gap; }
      if (lay && lay.x != null) lx += lay.x * W;
      if (lay && lay.y != null) ly += lay.y * H;
    }
    legendDraw = { rows, lx, ly, lw, lh, lpad, rowH, fsz, vertical, L, swatchW };
  }

  /* Category labels */
  function catLabels(s, n, ax) {
    const out = [];
    const x = s && s.x;
    const code = ax && ax.numFmt && !ax.numFmt.linked ? ax.numFmt.code : (x && x.fmt);
    for (let i = 0; i < n; i++) {
      let lab = null;
      if (x) {
        const sv = x.strs[i], nv = x.nums[i];
        if (x.isNum && nv != null) lab = fmtNum(nv, code || 'General');
        else if (sv != null) lab = sv;
      }
      out.push(lab == null ? String(i + 1) : lab);
    }
    return out;
  }

  if (pieOnly) drawPie(C);
  else if (own === 'radar') drawRadar(C);
  else if (own === 'treemap') drawTreemap(C);
  else if (own === 'sunburst') drawSunburst(C);
  else drawAxisChart(C);

  /* Legend drawing */
  if (legendDraw) {
    const { rows, lx, ly, lw, lh, lpad, rowH, fsz, vertical, L, swatchW } = legendDraw;
    const lst = strokeOf(L.line, null, k);
    if (L.fill || lst) dl.path(rectD(lx, ly, lw, lh), Object.assign({ fill: L.fill || null }, lst || {}));
    rows.forEach((row, ri) => {
      const cy = ly + lpad + ri * rowH + rowH / 2;
      const rowW = row.reduce((a, e, i) => a + e.w + (i ? 9 * k : 0), 0);
      let x = vertical ? lx + lpad : lx + (lw - rowW) / 2;
      for (const e of row) {
        const sw = swatchW(e);
        if (e.kind === 'swatch') {
          const b = fsz * 0.7;
          dl.path(rectD(x, cy - b / 2, b, b), Object.assign({ fill: e.fill || null }, strokeOf(e.line, null, k) || {}));
        } else if (e.kind === 'bubble') {
          const b = fsz * 0.7;
          dl.path(circleD(x + b / 2, cy, b / 2), Object.assign({ fill: fillFor(e.g, e.s, e.i != null ? e.i : null) || null }, strokeOf(e.s.line, null, k) || {}));
        } else if (e.kind === 'box') {
          const b = fsz * 0.7;
          const fill = e.i != null ? fillFor(e.g, e.s, e.i) : fillFor(e.g, e.s, null);
          const ol = (e.i != null && e.s.dPts[e.i] && e.s.dPts[e.i].line) || e.s.line;
          dl.path(rectD(x, cy - b / 2, b, b), Object.assign({ fill: fill || null }, strokeOf(ol, null, k) || {}));
        } else if (e.kind === 'trend') {
          const st = strokeOf(e.t.line, { color: lineColorFor(e.s), w: 1.5, dash: 'sysDot' }, k);
          if (st) dl.path(lineD([[x, cy], [x + sw, cy]]), st);
        } else {
          const st = e.i != null ? null : seriesLine(e.g, e.s);
          if (st) dl.path(lineD([[x, cy], [x + sw, cy]]), Object.assign({}, st, { sw: Math.min(st.sw, 3 * k) }));
          const mk = markerFor(e.g, e.s, e.i);
          if (mk) drawMarker(Object.assign({}, mk, { size: Math.min(mk.size, fsz * 0.9) }), x + sw / 2, cy);
          if (e.i != null && !mk) { const b = fsz * 0.7; dl.path(rectD(x + sw / 2 - b / 2, cy - b / 2, b, b), { fill: fillFor(e.g, e.s, e.i) }); }
        }
        drawBlock(e.b, x + sw + 4 * k + e.b.w / 2, cy, 0);
        x += e.w + 9 * k;
      }
    });
  }
  if (titleDraw) {
    const t = titleSpec;
    const st = t && strokeOf(t.line, null, k);
    if (t && (t.fill || st)) dl.path(rectD(titleDraw.cx - titleDraw.b.w / 2 - 3 * k, titleDraw.cy - titleDraw.b.h / 2 - 2 * k, titleDraw.b.w + 6 * k, titleDraw.b.h + 4 * k), Object.assign({ fill: t.fill || null }, st || {}));
    drawBlock(titleDraw.b, titleDraw.cx, titleDraw.cy, 0);
  }
  return dl.items;

  /* ===== Pie and doughnut ===== */
  function drawPie(area) {
    let rect = area;
    const pl = m.plotLayout;
    if (pl && pl.x != null && pl.w != null) rect = { x: pl.x * W, y: pl.y * H, w: pl.w * W, h: pl.h * H };
    const g = m.groups[0];
    if (g.ofPie && g.sers[0]) return drawOfPie(g, g.sers[0], rect);
    const sers = g.type === 'pie' ? g.sers.slice(0, 1) : g.sers;
    const dlab = s => mergeDL(g.dLbls, s.dLbls);
    const lf = s => mkFont(base, (dlab(s) || {}).font);
    let outside = sers.some(s => { const d = dlab(s); return d && !d.del && (d.val || d.cat || d.pct || d.ser) && (d.pos === 'outEnd' || d.pos === 'bestFit' || !d.pos); });
    let maxExp = 0;
    for (const s of sers) { maxExp = Math.max(maxExp, s.explosion || 0); for (const d of Object.values(s.dPts)) maxExp = Math.max(maxExp, d.explosion || 0); }
    let R = Math.min(rect.w, rect.h) / 2;
    if (outside && g.type === 'pie' && !(pl && pl.target === 'inner')) R -= SZ(base) * 1.6;
    R = Math.max(R / (1 + maxExp / 100), 4);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const hole = g.type === 'doughnut' ? R * Math.min(Math.max(g.holeSize, 10), 90) / 100 : 0;
    const ringW = (R - hole) / Math.max(sers.length, 1);
    const pt = (a, r, ox, oy) => [ox + r * Math.sin(a), oy - r * Math.cos(a)];
    sers.forEach((s, si) => {
      const vals = (s.y ? s.y.nums : []).map(v => v == null ? 0 : Math.abs(v));
      const tot = vals.reduce((a, b) => a + b, 0);
      if (tot <= 0) return;
      const rOut = g.type === 'doughnut' ? hole + ringW * (si + 1) : R, rIn = g.type === 'doughnut' ? hole + ringW * si : 0;
      let a0 = (g.firstSliceAng || 0) * Math.PI / 180;
      const labels = catLabels(s, vals.length, null);
      const D = dlab(s), font = lf(s);
      vals.forEach((v, i) => {
        if (v <= 0) return;
        const a1 = a0 + v / tot * 2 * Math.PI, mid = (a0 + a1) / 2;
        const exp = ((s.dPts[i] && s.dPts[i].explosion != null) ? s.dPts[i].explosion : s.explosion || 0) / 100 * R;
        const ox = cx + exp * Math.sin(mid), oy = cy - exp * Math.cos(mid);
        let d;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        if (v / tot > 0.99999) {
          d = circleD(ox, oy, rOut) + (rIn > 0 ? circleD(ox, oy, rIn) : '');
        } else if (rIn > 0) {
          const p0 = pt(a0, rOut, ox, oy), p1 = pt(a1, rOut, ox, oy), q1 = pt(a1, rIn, ox, oy), q0 = pt(a0, rIn, ox, oy);
          d = `M${r2(p0[0])} ${r2(p0[1])}A${r2(rOut)} ${r2(rOut)} 0 ${large} 1 ${r2(p1[0])} ${r2(p1[1])}L${r2(q1[0])} ${r2(q1[1])}A${r2(rIn)} ${r2(rIn)} 0 ${large} 0 ${r2(q0[0])} ${r2(q0[1])}Z`;
        } else {
          const p0 = pt(a0, rOut, ox, oy), p1 = pt(a1, rOut, ox, oy);
          d = `M${r2(ox)} ${r2(oy)}L${r2(p0[0])} ${r2(p0[1])}A${r2(rOut)} ${r2(rOut)} 0 ${large} 1 ${r2(p1[0])} ${r2(p1[1])}Z`;
        }
        const ol = (s.dPts[i] && s.dPts[i].line) || s.line;
        const st = Object.assign({ fill: fillFor(g, s, i), evenodd: true }, strokeOf(ol, { color: { c: '#ffffff', a: 1 }, w: 1 }, k) || {});
        st.join = 'round';
        dl.path(d, st);
        if (D && !D.del && !D.hidden.has(i)) {
          const txt = labelText(D, s, i, v, labels[i], v / tot);
          if (txt) {
            const b = simple(txt, font);
            const pos = D.pos || 'bestFit';
            let rr;
            if (pos === 'ctr') rr = (rOut + rIn) / 2;
            else if (pos === 'inEnd') rr = rOut - Math.max(b.w, b.h) * 0.6;
            else if (pos === 'outEnd' || (pos === 'bestFit' && g.type === 'pie' && b.w > (a1 - a0) * rOut * 0.6)) rr = rOut + 4 * k + Math.abs(Math.sin(mid)) * b.w / 2 + Math.abs(Math.cos(mid)) * b.h / 2;
            else rr = g.type === 'doughnut' ? (rOut + rIn) / 2 : rOut * 0.62;
            const [lx, ly] = pt(mid, rr, ox, oy);
            drawBlock(b, lx, ly, 0);
          }
        }
        a0 = a1;
      });
    });
  }

  /* ===== Pie of pie and bar of pie ===== */
  function drawOfPie(g, s, rect) {
    const op = g.ofPie;
    const vals = (s.y ? s.y.nums : []).map(v => v == null ? 0 : Math.abs(v));
    const n = vals.length, tot = vals.reduce((a, b) => a + b, 0);
    if (tot <= 0) return;
    const sec = new Set();
    if (op.splitType === 'cust') op.cust.forEach(i => { if (i >= 0 && i < n) sec.add(i); });
    else if (op.splitType === 'val') vals.forEach((v, i) => { if (v < (op.splitPos != null ? op.splitPos : 0)) sec.add(i); });
    else if (op.splitType === 'percent') vals.forEach((v, i) => { if (v / tot * 100 < (op.splitPos != null ? op.splitPos : 10)) sec.add(i); });
    else { const c = op.splitType === 'pos' && op.splitPos != null ? Math.round(op.splitPos) : Math.max(1, Math.round(n / 3)); for (let i = Math.max(0, n - c); i < n; i++) sec.add(i); }
    const secIdx = [...sec].sort((a, b) => a - b), mainIdx = vals.map((_, i) => i).filter(i => !sec.has(i));
    const other = secIdx.reduce((a, i) => a + vals[i], 0);
    const D = mergeDL(g.dLbls, s.dLbls), font = mkFont(base, (D || {}).font);
    const showLab = !!(D && !D.del && (D.val || D.cat || D.pct || D.ser));
    const labels = catLabels(s, n, null);
    const isBar = op.type === 'bar';
    const sF = Math.min(Math.max(op.second, 5), 200) / 100, gF = Math.min(Math.max(op.gap, 0), 500) / 100;
    const lp = showLab ? SZ(font) * 1.8 : 4 * k;
    // Widths in units of the main radius: the second plot is a pie of radius
    // sF, or a bar 2·sF tall and about a third as wide; the gap scales with it.
    const secW = isBar ? 2 * sF * 0.32 : 2 * sF, gapW = (isBar ? 2 * sF * 0.32 : sF) * gF * 0.6;
    const R = Math.max(4, Math.min((rect.h - 2 * lp) / (2 * Math.max(1, sF)), (rect.w - 2 * lp) / (2 + gapW + secW)));
    const x0 = rect.x + (rect.w - R * (2 + gapW + secW)) / 2, cy = rect.y + rect.h / 2, cx1 = x0 + R;
    const P = (cx, r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const sliceSt = (i, fill) => Object.assign({ fill: fill || null, evenodd: true, join: 'round' }, strokeOf((s.dPts[i] && s.dPts[i].line) || s.line, { color: { c: '#ffffff', a: 1 }, w: 1 }, k) || {});
    const lab = (i, v, cat) => showLab && !(D.hidden && D.hidden.has(i)) ? labelText(D, s, i, v, cat, v / tot) : '';
    function pieLab(txt, cx, r, a0, a1) {
      if (!txt) return;
      const b = simple(txt, font), mid = (a0 + a1) / 2, pos = D.pos || 'bestFit';
      let rr;
      if (pos === 'ctr') rr = r / 2;
      else if (pos === 'inEnd') rr = r - Math.max(b.w, b.h) * 0.6;
      else if (pos === 'outEnd' || (pos === 'bestFit' && b.w > (a1 - a0) * r * 0.6)) rr = r + 4 * k + Math.abs(Math.sin(mid)) * b.w / 2 + Math.abs(Math.cos(mid)) * b.h / 2;
      else rr = r * 0.62;
      const [x, y] = P(cx, rr, mid);
      drawBlock(b, x, y, 0);
    }
    // Main pie, turned so that "Other" faces the second plot.
    let a = Math.PI / 2 + (other / tot) * Math.PI, otherA = null;
    const slices = mainIdx.map(i => ({ i, v: vals[i], cat: labels[i] }));
    if (other > 0) slices.push({ i: n, v: other, cat: 'Other' });
    for (const sl of slices) {
      if (sl.v <= 0) continue;
      const a1 = a + sl.v / tot * 2 * Math.PI;
      dl.path(sectorD(cx1, cy, R, 0, a, a1), sliceSt(sl.i, fillFor(g, s, sl.i)));
      pieLab(lab(sl.i, sl.v, sl.cat), cx1, R, a, a1);
      if (sl.i === n) otherA = [a, a1];
      a = a1;
    }
    const cx2 = x0 + R * (2 + gapW);
    const lineSt = op.serLines ? strokeOf(op.serLines, { color: { c: '#868686', a: 1 }, w: 0.75 }, k) : null;
    let top, bottom;
    if (isBar) {
      const bh = 2 * R * sF, bw = R * secW;
      let y = cy + bh / 2;
      for (const i of secIdx) {
        const h = other ? vals[i] / other * bh : 0;
        if (h <= 0) continue;
        dl.path(rectD(cx2, y - h, bw, h), Object.assign(sliceSt(i, fillFor(g, s, i)), { evenodd: false, join: 'miter' }));
        const txt = lab(i, vals[i], labels[i]);
        if (txt) { const b = simple(txt, font); const inside = D.pos === 'ctr' || D.pos === 'inEnd' || D.pos === 'inBase'; drawBlock(b, inside ? cx2 + bw / 2 : cx2 + bw + 4 * k + b.w / 2, y - h / 2, 0); }
        y -= h;
      }
      top = [cx2, cy - bh / 2]; bottom = [cx2, cy + bh / 2];
    } else {
      const r2s = R * sF, ccx = cx2 + r2s;
      let b0 = Math.PI * 1.5 - (secIdx.length && other ? vals[secIdx[0]] / other * Math.PI : 0);
      for (const i of secIdx) {
        if (vals[i] <= 0) continue;
        const b1 = b0 + vals[i] / other * 2 * Math.PI;
        dl.path(sectorD(ccx, cy, r2s, 0, b0, b1), sliceSt(i, fillFor(g, s, i)));
        pieLab(lab(i, vals[i], labels[i]), ccx, r2s, b0, b1);
        b0 = b1;
      }
      top = [ccx, cy - r2s]; bottom = [ccx, cy + r2s];
    }
    if (lineSt && otherA) {
      const p0 = P(cx1, R, otherA[0]), p1 = P(cx1, R, otherA[1]);
      dl.path(lineD([p0, top]) + lineD([p1, bottom]), lineSt);
    }
  }
  function sectorD(cx, cy, rOut, rIn, a0, a1) {
    if (a1 - a0 >= 2 * Math.PI - 1e-6) return circleD(cx, cy, rOut) + (rIn > 0 ? circleD(cx, cy, rIn) : '');
    const pt = (a, r) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0, p0 = pt(a0, rOut), p1 = pt(a1, rOut);
    if (rIn > 0) {
      const q1 = pt(a1, rIn), q0 = pt(a0, rIn);
      return `M${r2(p0[0])} ${r2(p0[1])}A${r2(rOut)} ${r2(rOut)} 0 ${large} 1 ${r2(p1[0])} ${r2(p1[1])}L${r2(q1[0])} ${r2(q1[1])}A${r2(rIn)} ${r2(rIn)} 0 ${large} 0 ${r2(q0[0])} ${r2(q0[1])}Z`;
    }
    return `M${r2(cx)} ${r2(cy)}L${r2(p0[0])} ${r2(p0[1])}A${r2(rOut)} ${r2(rOut)} 0 ${large} 1 ${r2(p1[0])} ${r2(p1[1])}Z`;
  }
  /* Rect-relative plot area when the chart sets one, otherwise the space left over. */
  function plotRect(area) {
    const pl = m.plotLayout;
    return pl && pl.x != null && pl.w != null ? { x: pl.x * W, y: pl.y * H, w: pl.w * W, h: pl.h * H, inner: pl.target === 'inner' } : area;
  }
  /* Longest prefix of a label that fits, with an ellipsis. */
  function clipText(t, f, maxW) {
    const sz = SZ(f);
    if (M(t, f, sz) <= maxW) return t;
    let lo = 0, hi = t.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (M(t.slice(0, mid) + '…', f, sz) <= maxW) lo = mid; else hi = mid - 1; }
    return lo > 0 ? t.slice(0, lo) + '…' : '';
  }

  /* ===== Radar ===== */
  function drawRadar(area) {
    const gs = m.groups.filter(g => g.type === 'radar'), g0 = gs[0];
    const ca = m.axes[g0.axIds[0]] || blankAxis('_rc', 'cat', 'b', { deleted: false, lblPos: 'nextTo', majorGrid: {} });
    const va = m.axes[g0.axIds[1]] || blankAxis('_rv', 'val', 'l', { deleted: false, lblPos: 'nextTo', majorGrid: {} });
    const all = gs.flatMap(g => g.sers);
    const n = Math.max(1, ...all.map(s => Math.max(s.y ? s.y.nums.length : 0, s.x ? s.x.strs.length : 0)));
    const labels = catLabels(all.find(s => s.x) || null, n, ca);
    let lo = Infinity, hi = -Infinity;
    for (const s of all) (s.y ? s.y.nums : []).slice(0, n).forEach(v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const cf = mkFont(base, ca.font), vf = mkFont(base, va.font), vfs = SZ(vf);
    const showCat = !ca.deleted && ca.lblPos !== 'none', showVal = !va.deleted && va.lblPos !== 'none';
    const ang = i => 2 * Math.PI * i / n;
    const catB = labels.map(t => simple(t, cf));
    const off = 5 * k, rect = plotRect(area);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    let R = Math.min(rect.w, rect.h) / 2;
    // Shrink until every category label fits inside the chart.
    if (!rect.inner && showCat) for (let i = 0; i < n; i++) {
      const dx = Math.abs(Math.sin(ang(i))), dy = Math.abs(Math.cos(ang(i))), b = catB[i];
      if (dx > 1e-6) R = Math.min(R, (rect.w / 2 - b.w / 2 * (1 + dx)) / dx - off);
      if (dy > 1e-6) R = Math.min(R, (rect.h / 2 - b.h / 2 * (1 + dy)) / dy - off);
    }
    R = Math.max(R, Math.min(rect.w, rect.h) * 0.12);
    const sc = scaleRange({ lo, hi }, va, Math.min(8, Math.max(2, Math.floor(R / (vfs * 2)))));
    let fmt = va.numFmt && !va.numFmt.linked && va.numFmt.code ? va.numFmt.code : null;
    if (!fmt) { const s1 = all.find(s => s.y && s.y.fmt); fmt = s1 ? s1.y.fmt : 'General'; }
    const vlab = v => fmtNum(va.dispDiv ? v / va.dispDiv : v, fmt);
    const span = (sc.max - sc.min) || 1;
    const rOf = v => (Math.min(Math.max(v, sc.min), sc.max) - sc.min) / span * R;
    const P = (i, r) => [cx + r * Math.sin(ang(i)), cy - r * Math.cos(ang(i))];
    const poly = r => lineD(Array.from({ length: n }, (_, i) => P(i, r))) + 'Z';
    if (m.plotFill) dl.path(poly(R), { fill: m.plotFill });
    const grid = (spec, minor) => strokeOf(spec, { color: { c: minor ? '#F2F2F2' : '#D9D9D9', a: 1 }, w: 0.75 }, k);
    if (va.minorGrid) { const st = grid(va.minorGrid, true); if (st) dl.path(sc.minor.map(rOf).filter(r => r > 0.5).map(poly).join(''), st); }
    if (va.majorGrid) { const st = grid(va.majorGrid); if (st) dl.path(sc.ticks.map(rOf).filter(r => r > 0.5).map(poly).join(''), st); }
    if (ca.majorGrid) {
      const st = grid(ca.majorGrid);
      if (st) { let d = ''; for (let i = 0; i < n; i++) { const p = P(i, R); d += `M${r2(cx)} ${r2(cy)}L${r2(p[0])} ${r2(p[1])}`; } dl.path(d, st); }
    }
    if (!ca.deleted) { const st = strokeOf(ca.line, { color: { c: '#D9D9D9', a: 1 }, w: 0.75 }, k); if (st) dl.path(poly(R), st); }
    const drawn = [];
    for (const g of gs) for (const s of g.sers) {
      const pts = Array.from({ length: n }, (_, i) => { const v = s.y ? s.y.nums[i] : null; return v == null || !isFinite(v) ? null : P(i, rOf(v)); });
      if (g.radarStyle === 'filled') {
        dl.path(lineD(pts.map((p, i) => p || P(i, 0))) + 'Z', Object.assign({ fill: fillFor(g, s, null) || null }, strokeOf(s.line, null, k) || {}, { join: 'round' }));
      } else {
        const st = seriesLine(g, s);
        if (st) {
          let d = '';
          if (pts.every(Boolean)) d = lineD(pts) + 'Z';
          else { let cur = []; for (const p of pts.concat([pts[0]])) { if (p) cur.push(p); else { if (cur.length > 1) d += lineD(cur); cur = []; } } if (cur.length > 1) d += lineD(cur); }
          dl.path(d, Object.assign({}, st, { join: 'round' }));
        }
      }
      drawn.push({ g, s, pts });
    }
    for (const { g, s, pts } of drawn) {
      pts.forEach((p, i) => { if (!p) return; const mk = markerFor(g, s, i); if (mk) drawMarker(mk, p[0], p[1]); });
      const D = mergeDL(g.dLbls, s.dLbls);
      if (D && !D.del && (D.val || D.cat || D.ser)) pts.forEach((p, i) => {
        if (!p || D.hidden.has(i)) return;
        const txt = labelText(D, s, i, s.y.nums[i], labels[i], null); if (!txt) return;
        const b = simple(txt, mkFont(base, D.font)), a = ang(i), rr = Math.hypot(p[0] - cx, p[1] - cy) + 4 * k;
        drawBlock(b, cx + (rr + b.w / 2) * Math.sin(a), cy - (rr + b.h / 2) * Math.cos(a), 0);
      });
    }
    if (!va.deleted) {
      const st = strokeOf(va.line, { color: { c: '#868686', a: 1 }, w: 0.75 }, k);
      if (st) {
        dl.path(`M${r2(cx)} ${r2(cy)}V${r2(cy - R)}`, st);
        const t = va.majorTick, sp = t === 'cross' ? [-3, 3] : t === 'out' ? [-4, 0] : t === 'in' ? [0, 4] : null;
        if (sp) dl.path(sc.ticks.map(v => `M${r2(cx + sp[0] * k)} ${r2(cy - rOf(v))}H${r2(cx + sp[1] * k)}`).join(''), Object.assign({}, st, { dash: null }));
      }
    }
    if (showVal) for (const v of sc.ticks) { const b = simple(vlab(v), vf); drawBlock(b, cx - off - b.w / 2, cy - rOf(v), 0); }
    if (showCat) for (let i = 0; i < n; i++) {
      const a = ang(i), b = catB[i];
      drawBlock(b, cx + (R + off + b.w / 2) * Math.sin(a), cy - (R + off + b.h / 2) * Math.cos(a), 0);
    }
  }

  /* ===== Treemap ===== */
  /* Squarified layout (Bruls, Huizing and van Wijk): rows along the shorter
     side, closed when the next item would make the worst aspect ratio worse. */
  function squarify(vals, rect) {
    const out = vals.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
    const total = vals.reduce((a, b) => a + b, 0);
    if (!(total > 0) || rect.w <= 0 || rect.h <= 0) return out;
    const items = vals.map((v, i) => ({ a: v * rect.w * rect.h / total, i }));
    let r = Object.assign({}, rect), row = [], sum = 0, idx = 0;
    const worst = (rw, s, side) => {
      if (!rw.length) return Infinity;
      let mx = 0, mn = Infinity; for (const it of rw) { mx = Math.max(mx, it.a); mn = Math.min(mn, it.a); }
      const s2 = s * s, w2 = side * side; return Math.max(w2 * mx / s2, s2 / (w2 * mn));
    };
    const place = () => {
      if (r.w >= r.h) { const w = r.h > 0 ? sum / r.h : 0; let y = r.y; for (const it of row) { const h = w > 0 ? it.a / w : 0; out[it.i] = { x: r.x, y, w, h }; y += h; } r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h }; }
      else { const h = r.w > 0 ? sum / r.w : 0; let x = r.x; for (const it of row) { const w = h > 0 ? it.a / h : 0; out[it.i] = { x, y: r.y, w, h }; x += w; } r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h }; }
      row = []; sum = 0;
    };
    while (idx < items.length) {
      const it = items[idx], side = Math.min(r.w, r.h);
      if (!row.length || worst(row.concat([it]), sum + it.a, side) <= worst(row, sum, side)) { row.push(it); sum += it.a; idx++; }
      else place();
    }
    if (row.length) place();
    return out;
  }
  function drawTreemap(area) {
    const g = m.groups[0], s = g.sers[0], tree = m.tree;
    if (!tree || !(tree.total > 0)) return;
    const D = g.dLbls && !g.dLbls.del ? g.dLbls : null;
    const lf = mkFont(base, { color: WHITE }, D && D.font), pf = mkFont(lf, { size: lf.size * 1.3, bold: true });
    const pad = 4 * k, est = strokeOf(s.line, { color: WHITE, w: 1.5 }, k);
    const rect = plotRect(area), leaves = [], parents = [];
    const valText = v => fmtNum(v, D && D.numFmt && !D.numFmt.linked ? D.numFmt.code : g.sizeFmt || 'General');
    function textAt(lines, f, x, y, maxW, maxH) {
      const lh = SZ(f) * 1.2; let used = 0;
      for (const t of lines) {
        if (used + lh > maxH + 0.5) break;
        const txt = clipText(t, f, maxW); if (!txt) break;
        const b = simple(txt, f); drawBlock(b, x + b.w / 2, y + used + b.h / 2, 0); used += lh;
      }
      return used;
    }
    (function lay(nodes, r) {
      const list = nodes.filter(nd => nd.total > 0).sort((a, b) => b.total - a.total);
      const rects = squarify(list.map(nd => nd.total), r);
      list.forEach((nd, j) => {
        const rr = rects[j];
        if (!(rr.w > 0 && rr.h > 0)) return;
        const kids = nd.children.filter(c => c.total > 0);
        if (!kids.length) {
          dl.path(rectD(rr.x, rr.y, rr.w, rr.h), Object.assign({ fill: nd.color }, est || {}, { join: 'miter' }));
          leaves.push({ nd, rr });
          return;
        }
        // A parent's own value becomes one more tile beside its children.
        const items = nd.own > 0 ? kids.concat([{ name: nd.name, children: [], own: nd.own, total: nd.own, color: nd.color }]) : kids;
        let inner = rr;
        if (g.parentLabel === 'banner') {
          const bh = Math.min(SZ(pf) * 1.5, rr.h * 0.35);
          dl.path(rectD(rr.x, rr.y, rr.w, bh), Object.assign({ fill: { c: rgbToHex(...lum(hexToRgb(nd.color.c), 0.8, 0)), a: 1 } }, est || {}, { join: 'miter' }));
          if (D && D.cat) textAt([nd.name], pf, rr.x + pad, rr.y + (bh - SZ(pf) * 1.2) / 2, rr.w - 2 * pad, bh);
          inner = { x: rr.x, y: rr.y + bh, w: rr.w, h: rr.h - bh };
        } else if (g.parentLabel !== 'none' && D && D.cat) parents.push({ nd, rr });
        lay(items, inner);
      });
    })(tree.children, rect);
    // Overlapping parent names sit in the top-left corner; leaf labels step below them.
    const boxes = parents.map(({ nd, rr }) => {
      const t = clipText(nd.name, pf, rr.w - 2 * pad);
      return { t, x: rr.x, y: rr.y, w: t ? M(t, pf, SZ(pf)) + 2 * pad : 0, h: t ? SZ(pf) * 1.2 + pad : 0, rr };
    });
    if (D) for (const { nd, rr } of leaves) {
      const lines = [];
      if (D.ser) lines.push(s.name);
      if (D.cat) lines.push(nd.name);
      if (D.val) lines.push(valText(nd.total));
      let y = rr.y + pad;
      for (const b of boxes) if (b.t && rr.x < b.x + b.w && rr.x + rr.w > b.x && y >= b.y - 0.5 && y < b.y + b.h) y = b.y + b.h;
      textAt(lines, lf, rr.x + pad, y, rr.w - 2 * pad, rr.y + rr.h - pad - y);
    }
    for (const b of boxes) if (b.t && b.rr.h > SZ(pf) * 1.3) textAt([b.t], pf, b.x + pad, b.y + pad, b.rr.w - 2 * pad, b.rr.h);
  }

  /* ===== Sunburst ===== */
  function drawSunburst(area) {
    const g = m.groups[0], s = g.sers[0], tree = m.tree;
    if (!tree || !(tree.total > 0)) return;
    const depthOf = nd => nd.children.length ? 1 + Math.max(...nd.children.map(depthOf)) : 0;
    const levels = Math.max(1, depthOf(tree));
    const rect = plotRect(area);
    const R = Math.max(4, Math.min(rect.w, rect.h) / 2 - 2 * k), cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const ringW = R / (levels + 0.25), hole = ringW * 0.25;
    const D = g.dLbls && !g.dLbls.del ? g.dLbls : null;
    const lf = mkFont(base, { color: WHITE }, D && D.font);
    const est = strokeOf(s.line, { color: WHITE, w: 1 }, k);
    const segsDrawn = [];
    (function walk(nd, a0, a1) {
      let a = a0;
      for (const c of nd.children) {
        if (!(c.total > 0)) continue;
        const sp = (a1 - a0) * c.total / nd.total, rIn = hole + (c.depth - 1) * ringW;
        dl.path(sectorD(cx, cy, rIn + ringW, rIn, a, a + sp), Object.assign({ fill: c.color, evenodd: true, join: 'round' }, est || {}));
        segsDrawn.push({ c, a0: a, a1: a + sp, rIn, rOut: rIn + ringW });
        if (c.children.length) walk(c, a, a + sp);
        a += sp;
      }
    })(tree, 0, 2 * Math.PI);
    if (!D) return;
    for (const L of segsDrawn) {
      const parts = [];
      if (D.ser) parts.push(s.name);
      if (D.cat) parts.push(L.c.name);
      if (D.val) parts.push(fmtNum(L.c.total, D.numFmt && !D.numFmt.linked ? D.numFmt.code : g.sizeFmt || 'General'));
      const txt = parts.join(D.sep != null ? D.sep : ', ');
      if (!txt) continue;
      const b = simple(txt, lf), mid = (L.a0 + L.a1) / 2, rm = (L.rIn + L.rOut) / 2;
      const arc = Math.min((L.a1 - L.a0) * rm, 2 * rm), th = L.rOut - L.rIn;
      const x = cx + rm * Math.sin(mid), y = cy - rm * Math.cos(mid);
      const sn = Math.abs(Math.sin(mid)), cs = Math.abs(Math.cos(mid));
      // Upright if it fits across the segment, along the radius if it fits that way.
      if (cs * b.w + sn * b.h <= arc * 0.92 && sn * b.w + cs * b.h <= th * 0.92) drawBlock(b, x, y, 0);
      else if (b.w <= th * 0.9 && b.h <= arc * 0.9) { let rot = mid * 180 / Math.PI - 90; if (rot > 90) rot -= 180; drawBlock(b, x, y, rot); }
    }
  }

  function mergeDL(gd, sd) {
    if (!gd && !sd) return null;
    if (!gd) return sd; if (!sd) return gd;
    return Object.assign({}, gd, sd, { font: Object.assign({}, gd.font, sd.font) });
  }
  function labelText(D, s, i, v, cat, frac, size) {
    const parts = [];
    if (D.ser) parts.push(s.name);
    if (D.cat) parts.push(cat);
    if (D.val && v != null) parts.push(fmtNum(v, D.numFmt && !D.numFmt.linked ? D.numFmt.code : (s.y && s.y.fmt) || 'General'));
    if (D.pct && frac != null) parts.push(fmtNum(frac, D.numFmt && !D.numFmt.linked && /%/.test(D.numFmt.code) ? D.numFmt.code : '0%'));
    if (D.bub && size != null) parts.push(fmtNum(size, (s.size && s.size.fmt) || 'General'));
    return parts.join(D.sep != null ? D.sep : ', ');
  }

  /* ===== Axis-based charts ===== */
  function drawAxisChart(area) {
    const groups = m.groups.filter(g => !['pie', 'doughnut', 'radar', 'treemap', 'sunburst'].includes(g.type));
    const axes = m.axes;
    const used = [];
    const mkAxis = (id, kind, pos) => (axes[id] = blankAxis(id, kind, pos));
    for (const g of groups) {
      g.xy = g.type === 'scatter' || g.type === 'bubble';
      const ids = g.axIds.length >= 2 ? g.axIds : ['_x' + groups.indexOf(g), '_y' + groups.indexOf(g)];
      const a1 = axes[ids[0]] || mkAxis(ids[0], g.xy ? 'val' : 'cat', 'b');
      const a2 = axes[ids[1]] || mkAxis(ids[1], 'val', 'l');
      if (!a1.crossAx) a1.crossAx = a2.id; if (!a2.crossAx) a2.crossAx = a1.id;
      const horiz = g.type === 'bar' && g.barDir === 'bar';
      if (g.xy) { g.xa = a1; g.ya = a2; a1.dir = 'h'; a2.dir = 'v'; a1.role = 'val'; a2.role = 'val'; }
      else { g.ca = a1; g.va = a2; a1.dir = horiz ? 'v' : 'h'; a2.dir = horiz ? 'h' : 'v'; a1.role = 'cat'; a2.role = 'val'; }
      for (const a of [a1, a2]) if (!used.includes(a)) used.push(a);
    }
    /* Prepare data */
    for (const g of groups) {
      if (g.xy) {
        g.pts = g.sers.map(s => {
          const ny = s.y ? s.y.nums : [];
          const xnum = s.x && s.x.isNum && s.x.nums.some(v => v != null);
          return ny.map((y, i) => ({ x: xnum ? s.x.nums[i] : i + 1, y, z: g.type === 'bubble' ? (s.size ? s.size.nums[i] : 1) : null }));
        });
        continue;
      }
      const ca = g.ca;
      if (g.type === 'box') {
        const n = Math.max(1, g.cats.length);
        g.n = n; ca.n = Math.max(ca.n || 0, n);
        if (!ca.labels || ca.labels.length < n) ca.labels = g.cats.slice();
        g.pts = g.sers.map(() => []);
        if (!g.va.crossBetween) g.va.crossBetween = 'between';
        ca.between = true;
        continue;
      }
      const n = Math.max(1, ...g.sers.map(s => Math.max(s.y ? s.y.nums.length : 0, s.x ? s.x.strs.length : 0)));
      g.n = n;
      ca.n = Math.max(ca.n || 0, n);
      if (!ca.labels || ca.labels.length < n) ca.labels = catLabels(g.sers.find(s => s.x) || null, n, ca);
      const stacked = g.preset || g.grouping === 'stacked' || g.grouping === 'percentStacked', pct = g.grouping === 'percentStacked';
      g.stacked = stacked;
      const V = g.sers.map(s => { const a = (s.y ? s.y.nums : []).slice(0, n); while (a.length < n) a.push(null); return a; });
      g.pts = V.map(a => a.map(v => ({ v, lo: null, hi: v })));
      if (g.preset) {
        // Waterfall and funnel bars arrive with both ends already worked out.
        g.pts = g.sers.map(s => { const a = (s.presetPts || []).slice(0, n).map(p => Object.assign({}, p)); while (a.length < n) a.push({ v: null, lo: null, hi: null }); return a; });
      } else if (stacked) {
        for (let i = 0; i < n; i++) {
          let pos = 0, neg = 0, tot = 0;
          V.forEach(a => tot += Math.abs(a[i] || 0));
          V.forEach((a, si) => {
            let v = a[i]; const p = g.pts[si][i];
            if (v == null) { if (g.type === 'bar') { p.hi = null; return; } v = 0; }
            if (pct) v = tot ? v / tot : 0;
            if (g.type === 'bar' && v < 0) { p.lo = neg; p.hi = neg + v; neg = p.hi; }
            else { p.lo = pos; p.hi = pos + v; pos = p.hi; }
          });
        }
      } else if (g.type === 'line' && m.blanks === 'zero') g.pts.forEach(a => a.forEach(p => { if (p.hi == null) { p.hi = 0; } }));
      if (!g.va.crossBetween) g.va.crossBetween = g.type === 'area' ? 'midCat' : 'between';
      ca.between = (g.va.crossBetween || 'between') !== 'midCat';
      if (pct) g.va.pctDefault = true;
    }
    /* Error bars: compute amounts per point */
    function errAmounts(e, vals) {
      const nums = vals.filter(v => v != null && isFinite(v));
      const mean = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
      const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(nums.length - 1, 1));
      return vals.map((v, i) => {
        if (v == null) return null;
        let p, q, c = v;
        switch (e.valType) {
          case 'percentage': p = q = Math.abs(v) * e.val / 100; break;
          case 'stdDev': c = mean; p = q = e.val * sd; break;
          case 'stdErr': p = q = sd / Math.sqrt(nums.length || 1); break;
          case 'cust': p = e.plus ? (e.plus.nums[i] || 0) : 0; q = e.minus ? (e.minus.nums[i] || 0) : 0; break;
          default: p = q = e.val;
        }
        if (e.type === 'plus') q = 0; if (e.type === 'minus') p = 0;
        return { c, lo: c - Math.abs(q), hi: c + Math.abs(p) };
      });
    }
    for (const g of groups) {
      g.errs = g.sers.map((s, si) => s.errs.map(e => {
        const dir = g.xy ? e.dir : 'y';
        const vals = g.xy ? g.pts[si].map(p => dir === 'x' ? (p.y == null ? null : p.x) : p.y) : g.pts[si].map(p => p.hi);
        return { e, dir, amt: errAmounts(e, vals) };
      }));
    }
    /* Trendlines */
    for (const g of groups) {
      g.fits = g.sers.map((s, si) => s.trends.map(t => {
        const X = g.xy ? g.pts[si].map(p => p.x) : g.pts[si].map((_, i) => i + 1);
        const Y = g.xy ? g.pts[si].map(p => p.y) : g.pts[si].map(p => p.v);
        return { t, fit: fitTrend(t, X, Y) };
      }));
    }
    /* Domains */
    const dom = new Map();
    const addD = (ax, v) => { if (v == null || !isFinite(v)) return; if (ax.logBase && v <= 0) return; const d = dom.get(ax) || { lo: Infinity, hi: -Infinity }; d.lo = Math.min(d.lo, v); d.hi = Math.max(d.hi, v); dom.set(ax, d); };
    for (const g of groups) {
      if (g.type === 'box') {
        g.sers.forEach(s => s.stats.forEach(q => { if (!q) return; addD(g.va, q.lo); addD(g.va, q.hi); addD(g.va, q.mean); q.out.forEach(v => addD(g.va, v)); }));
      } else if (g.type === 'bubble') {
        // Excel widens the axes so the bubbles fit; approximate that by padding
        // each point by its radius as a share of the data span.
        const P = g.pts.flat().filter(p => p.x != null && p.y != null && p.z != null && (p.z > 0 || (g.showNeg && p.z < 0)));
        const zmax = Math.max(0, ...P.map(p => Math.abs(p.z)));
        const xs = P.map(p => p.x), ys = P.map(p => p.y);
        const sx = (Math.max(...xs) - Math.min(...xs)) || Math.abs(xs[0]) || 1, sy = (Math.max(...ys) - Math.min(...ys)) || Math.abs(ys[0]) || 1;
        const fr = 0.125 * g.bubbleScale / 100, x0 = Math.min(...xs), y0 = Math.min(...ys);
        for (const p of P) {
          const r = zmax ? fr * (g.sizeRep === 'w' ? Math.abs(p.z) / zmax : Math.sqrt(Math.abs(p.z) / zmax)) : 0;
          addD(g.xa, x0 >= 0 ? Math.max(0, p.x - r * sx) : p.x - r * sx); addD(g.xa, p.x + r * sx);
          addD(g.ya, y0 >= 0 ? Math.max(0, p.y - r * sy) : p.y - r * sy); addD(g.ya, p.y + r * sy);
        }
        g.errs.forEach(list => list.forEach(({ dir, amt }) => amt.forEach(a => { if (a) { addD(dir === 'x' ? g.xa : g.ya, a.lo); addD(dir === 'x' ? g.xa : g.ya, a.hi); } })));
      } else if (g.type === 'scatter') {
        g.pts.forEach((a, si) => a.forEach(p => { if (p.y != null && p.x != null) { addD(g.xa, p.x); addD(g.ya, p.y); } }));
        g.errs.forEach(list => list.forEach(({ dir, amt }) => amt.forEach(a => { if (a) { addD(dir === 'x' ? g.xa : g.ya, a.lo); addD(dir === 'x' ? g.xa : g.ya, a.hi); } })));
        g.fits.forEach(list => list.forEach(({ t, fit }) => { if (fit && fit.f && (t.forward || t.backward)) { addD(g.xa, fit.xmin); addD(g.xa, fit.xmax); } }));
      } else {
        g.pts.forEach(a => a.forEach(p => { addD(g.va, p.hi); if (g.stacked) addD(g.va, p.lo); }));
        g.errs.forEach(list => list.forEach(({ amt }) => amt.forEach(a => { if (a) { addD(g.va, a.lo); addD(g.va, a.hi); } })));
      }
    }
    /* Scales */
    const fontOf = a => mkFont(base, a.font);
    const valRange = (a, maxT, forceStep) => scaleRange(dom.get(a), a, maxT, forceStep);
    function valFmt(a) {
      if (a.numFmt && !a.numFmt.linked && a.numFmt.code) return a.numFmt.code;
      if (a.pctDefault) return '0%';
      for (const g of groups) for (const s of g.sers) {
        if ((g.va === a || g.ya === a) && s.y && s.y.fmt) return s.y.fmt;
        if (g.xa === a && s.x && s.x.fmt) return s.x.fmt;
      }
      return a.numFmt ? a.numFmt.code : 'General';
    }
    function buildScales(plot) {
      const S = new Map();
      for (const a of used) {
        const len = a.dir === 'h' ? plot.w : plot.h;
        let a1 = a.dir === 'h' ? plot.x : plot.y + plot.h, a2 = a.dir === 'h' ? plot.x + plot.w : plot.y;
        if (a.reversed) [a1, a2] = [a2, a1];
        if (a.role === 'cat') {
          const n = a.n || 1, between = a.between !== false;
          const span = between ? n : Math.max(n - 1, 1);
          const at = i => a1 + ((between ? i + 0.5 : i) / span) * (a2 - a1);
          S.set(a, { kind: 'cat', a, n, between, a1, a2, len, at, edge: f => a1 + f * (a2 - a1), band: len / span, idxEdge: j => a1 + ((j) / span) * (a2 - a1) });
        } else {
          const f = fontOf(a); const fs = SZ(f);
          let maxT = a.dir === 'v' ? Math.min(10, Math.max(2, Math.floor(len / (fs * 1.7)))) : Math.min(10, Math.max(2, Math.floor(len / (fs * 4))));
          let r = valRange(a, maxT);
          const fmt = valFmt(a);
          const lab = v => fmtNum(a.dispDiv ? v / a.dispDiv : v, fmt);
          if (a.dir === 'h' && !a.majorUnit && !a.logBase) {
            const fits = rr => rr.ticks.length <= 2 || (rr.ticks.length - 1) * (Math.max(...rr.ticks.map(v => M(lab(v), f, fs))) + fs * 1.2) <= len;
            const r0 = valRange(a, 10), s0 = r0.step;
            for (const mul of [1, 2, 4, 5, 10, 20, 40, 50, 100]) { const rr = mul === 1 ? r0 : valRange(a, 10, clean(s0 * mul)); r = rr; if (fits(rr)) break; }
          }
          const L = v => r.log ? Math.log(v) / Math.log(r.log) : v;
          const pos = v => a1 + (L(v) - L(r.min)) / ((L(r.max) - L(r.min)) || 1) * (a2 - a1);
          S.set(a, Object.assign({ kind: 'val', a, a1, a2, len, pos, edge: f => a1 + f * (a2 - a1), lab, fmt }, r));
        }
      }
      return S;
    }
    function crossValue(a, sp) {
      if (sp.kind === 'cat') return null;
      let v;
      if (a.crossesAt != null) v = a.crossesAt;
      else if (a.crosses === 'max') v = sp.max;
      else if (a.crosses === 'min') v = sp.min;
      else v = sp.log ? sp.min : (sp.min <= 0 && sp.max >= 0 ? 0 : sp.min > 0 ? sp.min : sp.max);
      return Math.min(Math.max(v, sp.min), sp.max);
    }
    function perp(a, S) {
      const c = axes[a.crossAx];
      if (c && S.has(c) && c.dir !== a.dir) return S.get(c);
      for (const [ax, sc] of S) if (ax.dir !== a.dir) return sc;
      return null;
    }
    function linePos(a, S) {
      const sp = perp(a, S); if (!sp) return null;
      if (sp.kind === 'cat') {
        if (a.crossesAt != null) return sp.idxEdge(Math.max(0, Math.min(sp.n, a.crossesAt - 1)));
        return sp.edge(a.crosses === 'max' ? 1 : 0);
      }
      return sp.pos(crossValue(a, sp));
    }
    /* Label geometry */
    function axisInfo(a, S, plot) {
      const sc = S.get(a); const sp = perp(a, S);
      const info = { a, sc, line: linePos(a, S), show: !a.deleted && a.lblPos !== 'none' };
      const f = fontOf(a); const fs = SZ(f);
      info.f = f; info.fs = fs;
      const tickOut = a.majorTick === 'out' || a.majorTick === 'cross' ? 4 * k : 0;
      info.off = tickOut + 3 * k;
      let lc;
      if (a.lblPos === 'low' && sp) lc = sp.edge(0); else if (a.lblPos === 'high' && sp) lc = sp.edge(1); else lc = info.line;
      if (lc == null) lc = a.dir === 'h' ? plot.y + plot.h : plot.x;
      info.lc = lc;
      if (a.dir === 'h') {
        const atTop = Math.abs(lc - plot.y) < 0.5 && Math.abs(lc - (plot.y + plot.h)) > 0.5;
        info.side = (a.lblPos === 'nextTo' || !a.lblPos) ? (atTop ? 't' : 'b') : (lc < plot.y + plot.h / 2 ? 't' : 'b');
        if (a.pos === 't' && a.lblPos === 'nextTo' && Math.abs(lc - plot.y) < 0.5) info.side = 't';
      } else {
        const atRight = Math.abs(lc - (plot.x + plot.w)) < 0.5 && Math.abs(lc - plot.x) > 0.5;
        info.side = (a.lblPos === 'nextTo' || !a.lblPos) ? (atRight ? 'r' : 'l') : (lc > plot.x + plot.w / 2 ? 'r' : 'l');
      }
      info.atEdge = info.side === 'b' ? Math.abs(lc - (plot.y + plot.h)) < 1 : info.side === 't' ? Math.abs(lc - plot.y) < 1 : info.side === 'l' ? Math.abs(lc - plot.x) < 1 : Math.abs(lc - (plot.x + plot.w)) < 1;
      info.labels = []; info.extent = 0; info.rot = 0; info.skip = 1;
      if (info.show) {
        const rotSet = a.font && a.font.rot != null ? a.font.rot : null;
        if (sc.kind === 'val') {
          info.labels = sc.ticks.map(v => ({ v, b: simple(sc.lab(v), f) }));
          if (rotSet) info.rot = rotSet;
        } else {
          const texts = (a.labels || []).slice(0, sc.n);
          while (texts.length < sc.n) texts.push(String(texts.length + 1));
          const band = sc.band;
          let blocks = texts.map(t => simple(t, f));
          const maxW = Math.max(0, ...blocks.map(b => b.w));
          const lineH = fs * 1.2;
          if (a.dir === 'h') {
            if (rotSet != null) info.rot = rotSet;
            else if (maxW > band * 0.96) {
              const wrapW = band * 0.96;
              const words = texts.map(t => t.split(/\s+/));
              const canWrap = words.every(ws => ws.every(w => M(w, f, fs) <= wrapW));
              if (canWrap && texts.some(t => /\s/.test(t))) {
                blocks = texts.map((t, i) => {
                  const lines = []; let cur = '';
                  for (const w of words[i]) { const tryS = cur ? cur + ' ' + w : w; if (cur && M(tryS, f, fs) > wrapW) { lines.push(cur); cur = w; } else cur = tryS; }
                  if (cur) lines.push(cur);
                  return block(lines.map(l => [{ text: l, f: {} }]), f);
                });
                if (Math.max(...blocks.map(b => b.lines.length)) > 3) { blocks = texts.map(t => simple(t, f)); info.rot = -45; }
              } else info.rot = -45;
            }
            if (info.rot) info.skip = Math.max(1, Math.ceil(lineH * 1.3 / Math.max(band, 0.1)));
            else info.skip = Math.max(1, Math.ceil((maxW + fs * 0.5) / Math.max(band, 0.1)));
            if (Math.max(...blocks.map(b => b.w)) <= band * 0.98) info.skip = 1;
          } else {
            info.skip = Math.max(1, Math.ceil(lineH / Math.max(band, 0.1)));
          }
          if (a.lblSkip) info.skip = a.lblSkip;
          info.labels = blocks.map((b, i) => ({ i, b }));
        }
        let ext = 0;
        for (const L of info.labels) { const bx = info.rot ? rotBox(L.b, info.rot) : L.b; ext = Math.max(ext, a.dir === 'h' ? bx.h : bx.w); }
        info.extent = ext + info.off;
      }
      if (a.title && !a.deleted || a.title && a.deleted === false) {
        const tf = mkFont(base, { bold: true }, a.title.font);
        const lines = a.title.lines && a.title.lines.length ? a.title.lines : [[{ text: 'Axis Title', f: {} }]];
        info.tb = block(lines, tf);
        const r = a.title.font.rot != null ? a.title.font.rot : (a.dir === 'v' ? -90 : 0);
        info.trot = a.title.font.vert === 'vert' ? 90 : r;
        const bx = rotBox(info.tb, info.trot);
        info.tExtent = (a.dir === 'h' ? bx.h : bx.w) + 5 * k;
      } else info.tExtent = 0;
      return info;
    }
    /* Layout iteration */
    const pl = m.plotLayout;
    const manual = pl && pl.x != null && pl.y != null && pl.w != null && pl.h != null;
    const manRect = manual ? { x: (pl.xMode === 'edge' || true) ? pl.x * W : pl.x * W, y: pl.y * H, w: pl.wMode === 'edge' ? (pl.w - pl.x) * W : pl.w * W, h: pl.hMode === 'edge' ? (pl.h - pl.y) * H : pl.h * H } : null;
    let plot = manual && pl.target === 'inner' ? manRect : { x: area.x + 30 * k, y: area.y + 6 * k, w: area.w - 40 * k, h: area.h - 30 * k };
    let S, infos;
    for (let it = 0; it < 4; it++) {
      S = buildScales(plot);
      infos = used.map(a => axisInfo(a, S, plot));
      if (manual && pl.target === 'inner') break;
      const ex = { l: 0, r: 0, t: 0, b: 0 }, tex = { l: 0, r: 0, t: 0, b: 0 };
      for (const inf of infos) {
        if (inf.show && inf.atEdge) ex[inf.side] = Math.max(ex[inf.side], inf.extent);
        if (inf.tExtent) tex[inf.side] += inf.tExtent;
      }
      const src = manual ? manRect : area;
      const tx = manual ? { l: 0, r: 0, t: 0, b: 0 } : tex;
      const half = (v) => v;
      // half of the outermost category label can stick out; keep a small margin at the ends
      const endPad = { l: 0, r: 0, t: SZ(base) * 0.6, b: 0 };
      for (const inf of infos) if (inf.show && inf.a.dir === 'v' && inf.sc.kind === 'val') { endPad.t = Math.max(endPad.t, inf.fs * 0.6); endPad.b = Math.max(endPad.b, ex.b ? 0 : inf.fs * 0.6); }
      for (const inf of infos) if (inf.show && inf.a.dir === 'h' && inf.sc.kind === 'val' && !inf.rot) { const lw = inf.labels.length ? inf.labels[inf.labels.length - 1].b.w / 2 : 0; endPad.r = Math.max(endPad.r, ex.r ? 0 : lw); endPad.l = Math.max(endPad.l, ex.l ? 0 : (inf.labels[0] ? inf.labels[0].b.w / 2 : 0)); }
      const np = {
        x: src.x + half(ex.l) + tx.l + endPad.l,
        y: src.y + ex.t + tx.t + endPad.t,
      };
      np.w = Math.max(src.w - (ex.l + ex.r + tx.l + tx.r + endPad.l + endPad.r), src.w * 0.2);
      np.h = Math.max(src.h - (ex.t + ex.b + tx.t + tx.b + endPad.t + endPad.b), src.h * 0.2);
      const same = Math.abs(np.x - plot.x) < 0.5 && Math.abs(np.y - plot.y) < 0.5 && Math.abs(np.w - plot.w) < 0.5 && Math.abs(np.h - plot.h) < 0.5;
      plot = np;
      if (same) break;
    }
    S = buildScales(plot);
    infos = used.map(a => axisInfo(a, S, plot));

    /* Plot area background */
    const pst = strokeOf(m.plotLine, null, k);
    if (m.plotFill || pst) dl.path(rectD(plot.x, plot.y, plot.w, plot.h), Object.assign({ fill: m.plotFill || null }, pst || {}));

    /* Gridlines */
    const gridSt = (ln, minor) => strokeOf(ln, { color: { c: minor ? '#F2F2F2' : '#D9D9D9', a: 1 }, w: 0.75 }, k);
    for (const minor of [true, false]) for (const inf of infos) {
      const a = inf.a, sc = inf.sc;
      const spec = minor ? a.minorGrid : a.majorGrid;
      if (!spec) continue;
      const st = gridSt(spec, minor); if (!st) continue;
      let coords = [];
      if (sc.kind === 'val') coords = (minor ? sc.minor : sc.ticks).map(v => sc.pos(v));
      else { const cnt = sc.between ? sc.n : sc.n - 1; for (let j = 0; j <= cnt; j++) coords.push(sc.idxEdge(j)); }
      let d = '';
      for (const c of coords) d += a.dir === 'h' ? `M${r2(c)} ${r2(plot.y)}V${r2(plot.y + plot.h)}` : `M${r2(plot.x)} ${r2(c)}H${r2(plot.x + plot.w)}`;
      dl.path(d, st);
    }

    /* Series */
    const clipR = { x: plot.x - 0.5 * k, y: plot.y - 0.5 * k, w: plot.w + 1 * k, h: plot.h + 1 * k };
    const labelsToDraw = [];
    for (const g of groups) {
      dl.clip(clipR);
      if (g.type === 'bar') drawBars(g);
      else if (g.type === 'area') drawArea(g);
      else if (g.type === 'line') drawLine(g);
      else if (g.type === 'scatter') drawScatter(g);
      else if (g.type === 'bubble') drawBubbles(g);
      else if (g.type === 'box') drawBox(g);
      drawErrs(g);
      drawTrends(g);
      dl.unclip();
      drawMarkers(g);
    }

    /* Axes */
    for (const inf of infos) {
      const a = inf.a, sc = inf.sc;
      if (a.deleted) continue;
      const lc = inf.line != null ? inf.line : (a.dir === 'h' ? plot.y + plot.h : plot.x);
      const ast = strokeOf(a.line, { color: { c: '#868686', a: 1 }, w: 0.75 }, k);
      if (ast) dl.path(a.dir === 'h' ? `M${r2(plot.x)} ${r2(lc)}H${r2(plot.x + plot.w)}` : `M${r2(lc)} ${r2(plot.y)}V${r2(plot.y + plot.h)}`, ast);
      const tickSt = ast || { stroke: { c: '#868686', a: 1 }, sw: 0.75 * k };
      const sgn = (inf.side === 'b' || inf.side === 'r') ? 1 : -1;
      const tickSpan = (type) => type === 'out' ? [0, 4 * k * sgn] : type === 'in' ? [-4 * k * sgn, 0] : type === 'cross' ? [-4 * k, 4 * k] : null;
      const tickAt = (coords, type, len) => {
        const sp = tickSpan(type); if (!sp) return;
        const f = len || 1;
        let d = '';
        for (const c of coords) d += a.dir === 'h' ? `M${r2(c)} ${r2(lc + sp[0] * f)}V${r2(lc + sp[1] * f)}` : `M${r2(lc + sp[0] * f)} ${r2(c)}H${r2(lc + sp[1] * f)}`;
        if (d && ast) dl.path(d, Object.assign({}, tickSt, { dash: null }));
      };
      if (sc.kind === 'val') { tickAt(sc.ticks.map(v => sc.pos(v)), a.majorTick); tickAt(sc.minor.map(v => sc.pos(v)), a.minorTick, 0.5); }
      else { const cnt = sc.between ? sc.n : sc.n - 1; const cs = []; const ms = a.markSkip || 1; for (let j = 0; j <= cnt; j += ms) cs.push(sc.idxEdge(j)); tickAt(cs, a.majorTick); }
      /* Labels */
      if (inf.show) {
        const lc2 = inf.lc;
        for (const L of inf.labels) {
          if (sc.kind === 'cat' && L.i % inf.skip !== 0) continue;
          const c = sc.kind === 'val' ? sc.pos(L.v) : sc.at(L.i);
          const b = L.b;
          if (a.dir === 'h') {
            const y0 = inf.side === 'b' ? lc2 + inf.off : lc2 - inf.off;
            if (inf.rot) {
              const ang = inf.rot * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
              let cx, cy;
              if (inf.side === 'b') { cx = c - ca * b.w / 2 + (-sa) * b.h / 2 * (inf.rot < 0 ? -1 : 1); cy = y0 + Math.abs(sa) * b.w / 2 + ca * b.h / 2; if (inf.rot < 0) cx = c - ca * b.w / 2 + Math.abs(sa) * b.h / 2 * 0; }
              else { cx = c + ca * b.w / 2; cy = y0 - Math.abs(sa) * b.w / 2 - ca * b.h / 2; }
              if (inf.side === 'b' && inf.rot < 0) { cx = c - ca * b.w / 2 + sa * 0; cy = y0 + (-sa) * b.w / 2 + ca * b.h / 2; }
              if (inf.side === 'b' && inf.rot > 0) { cx = c + ca * b.w / 2; cy = y0 + sa * b.w / 2 + ca * b.h / 2; }
              drawBlock(b, cx, cy, inf.rot);
            } else drawBlock(b, c, inf.side === 'b' ? y0 + b.h / 2 : y0 - b.h / 2, 0);
          } else {
            const x0 = inf.side === 'l' ? lc2 - inf.off : lc2 + inf.off;
            if (inf.rot) { const bx = rotBox(b, inf.rot); drawBlock(b, inf.side === 'l' ? x0 - bx.w / 2 : x0 + bx.w / 2, c, inf.rot); }
            else drawBlock(b, inf.side === 'l' ? x0 - b.w / 2 : x0 + b.w / 2, c, 0);
          }
        }
      }
    }
    /* Axis titles */
    const used2 = { l: 0, r: 0, t: 0, b: 0 };
    for (const inf of infos) {
      if (!inf.tb) continue;
      const a = inf.a, bx = rotBox(inf.tb, inf.trot);
      const lab = inf.show && inf.atEdge ? inf.extent : 0;
      let cx, cy;
      const lay = a.title.layout;
      if (a.dir === 'h') {
        cx = plot.x + plot.w / 2;
        cy = inf.side === 'b' ? plot.y + plot.h + lab + used2.b + 3 * k + bx.h / 2 : plot.y - lab - used2.t - 3 * k - bx.h / 2;
        used2[inf.side] += bx.h + 3 * k;
      } else {
        cy = plot.y + plot.h / 2;
        cx = inf.side === 'l' ? plot.x - lab - used2.l - 3 * k - bx.w / 2 : plot.x + plot.w + lab + used2.r + 3 * k + bx.w / 2;
        used2[inf.side] += bx.w + 3 * k;
      }
      if (lay && lay.x != null && lay.y != null) {
        if (lay.xMode === 'edge') cx = lay.x * W + bx.w / 2; else cx += lay.x * W;
        if (lay.yMode === 'edge') cy = lay.y * H + bx.h / 2; else cy += lay.y * H;
      }
      drawBlock(inf.tb, cx, cy, inf.trot);
    }
    for (const L of labelsToDraw) drawBlock(L.b, L.x, L.y, 0);

    /* ----- series painters ----- */
    function baseValue(g) {
      const vs = S.get(g.va);
      const cv = crossValue(g.ca, vs);
      return cv == null ? vs.min : cv;
    }
    function drawBars(g) {
      const cs = S.get(g.ca), vs = S.get(g.va);
      const nS = g.stacked ? 1 : g.sers.length;
      const ov = (g.overlap != null ? g.overlap : (g.stacked ? 100 : 0)) / 100;
      const gap = g.gapWidth / 100;
      const band = cs.len / cs.n;
      const bw = band / (nS - (nS - 1) * ov + gap);
      const dirc = Math.sign(cs.a2 - cs.a1) || 1;
      const bv = baseValue(g);
      const D0 = g.dLbls;
      g.sers.forEach((s, si) => {
        const D = mergeDL(D0, s.dLbls);
        const lab = (D && !D.del) ? D : null;
        g.pts[si].forEach((p, i) => {
          if (p.hi == null || i >= cs.n) return;
          const lo = g.stacked ? p.lo : bv, hi = p.hi;
          if (vs.log && (hi <= 0)) return;
          const off = gap * bw / 2 + (g.stacked ? 0 : si * bw * (1 - ov));
          const c0 = cs.idxEdge(i) + dirc * off, c1 = c0 + dirc * bw;
          const v0 = vs.pos(Math.min(Math.max(lo, vs.min), vs.max)), v1 = vs.pos(Math.min(Math.max(hi, vs.min), vs.max));
          const neg = p.v != null && p.v < 0;
          let fill = fillFor(g, s, i);
          if (neg && s.invert && !(s.dPts[i] && s.dPts[i].fill !== undefined)) fill = s.invertFill || { c: '#ffffff', a: 1 };
          const st = strokeOf((s.dPts[i] && s.dPts[i].line) || s.line, null, k);
          const d = g.va.dir === 'v' ? rectD(Math.min(c0, c1), Math.min(v0, v1), Math.abs(c1 - c0), Math.abs(v1 - v0)) : rectD(Math.min(v0, v1), Math.min(c0, c1), Math.abs(v1 - v0), Math.abs(c1 - c0));
          dl.path(d, Object.assign({ fill: fill || null }, st || {}, { join: 'miter' }));
          p.cx = (c0 + c1) / 2; p.vEnd = v1; p.vBase = v0; p.c0 = Math.min(c0, c1); p.c1 = Math.max(c0, c1);
          if (lab && !lab.hidden.has(i) && (lab.val || lab.cat || lab.ser)) {
            const txt = labelText(lab, s, i, p.v, (g.ca.labels || [])[i], null);
            const b = simple(txt, mkFont(base, lab.font));
            const pos = lab.pos || (g.stacked ? 'ctr' : 'outEnd');
            const up = Math.sign(v1 - v0) || -1; // direction from base to end in pixels
            const g2 = 3 * k; let along;
            const ext = g.va.dir === 'v' ? b.h : b.w;
            if (pos === 'ctr') along = (v0 + v1) / 2;
            else if (pos === 'inEnd') along = v1 - up * (g2 + ext / 2);
            else if (pos === 'inBase') along = v0 + up * (g2 + ext / 2);
            else along = v1 + up * (g2 + ext / 2);
            labelsToDraw.push(g.va.dir === 'v' ? { b, x: p.cx, y: along } : { b, x: along, y: p.cx });
          }
        });
      });
      // Waterfall connectors: from the end of each bar to the start of the next.
      const cst = g.connectors && strokeOf(g.connectors, null, k);
      if (cst && g.pts[0]) {
        let d = '';
        const P = g.pts[0];
        for (let i = 0; i + 1 < P.length; i++) {
          const p = P[i], q = P[i + 1];
          if (p.hi == null || q.hi == null || p.c1 == null || q.c0 == null) continue;
          const y = vs.pos(Math.min(Math.max(p.hi, vs.min), vs.max));
          const [a, b] = dirc > 0 ? [p.c1, q.c0] : [p.c0, q.c1];
          d += g.va.dir === 'v' ? `M${r2(a)} ${r2(y)}H${r2(b)}` : `M${r2(y)} ${r2(a)}V${r2(b)}`;
        }
        dl.path(d, cst);
      }
    }
    function drawBubbles(g) {
      const xs = S.get(g.xa), ys = S.get(g.ya);
      const ok = p => p.x != null && p.y != null && p.z != null && p.z !== 0 && (p.z > 0 || g.showNeg) && !(xs.log && p.x <= 0) && !(ys.log && p.y <= 0);
      const zmax = Math.max(0, ...g.pts.flat().filter(ok).map(p => Math.abs(p.z)));
      if (!zmax) return;
      const maxR = Math.min(plot.w, plot.h) * 0.125 * g.bubbleScale / 100;
      g.sers.forEach((s, si) => {
        const D = mergeDL(g.dLbls, s.dLbls);
        g.pts[si].forEach((p, i) => {
          if (!ok(p)) return;
          const rel = Math.abs(p.z) / zmax, r = Math.max(maxR * (g.sizeRep === 'w' ? rel : Math.sqrt(rel)), 0.75 * k);
          const cx = xs.pos(p.x), cy = ys.pos(p.y), base0 = fillFor(g, s, i);
          // Negative sizes are drawn hollow, as Excel does.
          const fill = p.z < 0 ? { c: '#ffffff', a: 1 } : base0;
          const st = strokeOf((s.dPts[i] && s.dPts[i].line) || s.line, p.z < 0 ? { color: base0, w: 0.75 } : null, k);
          dl.path(circleD(cx, cy, r), Object.assign({ fill: fill || null }, st || {}));
          if (D && !D.del && !D.hidden.has(i) && (D.val || D.cat || D.ser || D.bub)) {
            const txt = labelText(D, s, i, p.y, fmtNum(p.x, (s.x && s.x.fmt) || 'General'), null, p.z);
            if (!txt) return;
            const b = simple(txt, mkFont(base, D.font)), g2 = 3 * k, pos = D.pos || 'r';
            let x = cx, y = cy;
            if (pos === 't') y -= r + g2 + b.h / 2; else if (pos === 'b') y += r + g2 + b.h / 2;
            else if (pos === 'l') x -= r + g2 + b.w / 2; else if (pos !== 'ctr') x += r + g2 + b.w / 2;
            labelsToDraw.push({ b, x, y });
          }
        });
      });
    }
    function drawBox(g) {
      const cs = S.get(g.ca), vs = S.get(g.va);
      const nS = Math.max(1, g.sers.length), gap = g.gapWidth / 100;
      const bw = (cs.len / cs.n) / (nS + gap), dirc = Math.sign(cs.a2 - cs.a1) || 1;
      const V = v => vs.pos(Math.min(Math.max(v, vs.min), vs.max));
      g.sers.forEach((s, si) => {
        const color = fillFor(g, s, null) || seriesColor(theme, s.idx);
        const dark = { c: rgbToHex(...lum(hexToRgb(color.c), 0.6, 0)), a: 1 };
        const st = strokeOf(s.line, { color: dark, w: 0.75 }, k) || strokeOf(null, { color: dark, w: 0.75 }, k);
        const means = [];
        s.stats.forEach((q, i) => {
          if (!q || i >= cs.n) { means.push(null); return; }
          const c0 = cs.idxEdge(i) + dirc * (gap * bw / 2 + si * bw), c1 = c0 + dirc * bw;
          const cm = (c0 + c1) / 2, half = Math.abs(c1 - c0) / 2, cap = half * 0.5;
          const y1 = V(q.q1), y3 = V(q.q3);
          dl.path(`M${r2(cm)} ${r2(y3)}V${r2(V(q.hi))}M${r2(cm - cap)} ${r2(V(q.hi))}H${r2(cm + cap)}M${r2(cm)} ${r2(y1)}V${r2(V(q.lo))}M${r2(cm - cap)} ${r2(V(q.lo))}H${r2(cm + cap)}`, st);
          dl.path(rectD(cm - half, Math.min(y1, y3), 2 * half, Math.abs(y3 - y1)), Object.assign({ fill: color }, st, { join: 'miter' }));
          dl.path(`M${r2(cm - half)} ${r2(V(q.med))}H${r2(cm + half)}`, st);
          const dot = { symbol: 'circle', size: Math.min(5 * k, half), fill: { c: '#ffffff', a: 1 }, st: Object.assign({}, st, { dash: null }) };
          if (s.vis.nonoutliers) for (const v of q.inner) drawMarker(dot, cm, V(v));
          if (s.vis.outliers) for (const v of q.out) drawMarker(dot, cm, V(v));
          if (s.vis.meanMarker) drawMarker({ symbol: 'x', size: Math.min(7 * k, half), fill: null, st: Object.assign({}, st, { dash: null }) }, cm, V(q.mean));
          means.push([cm, V(q.mean)]);
        });
        if (s.vis.meanLine) { let d = ''; for (const sg of segs(means, false)) if (sg.length > 1) d += lineD(sg); dl.path(d, st); }
      });
    }
    function catPts(g, si, useStack) {
      const cs = S.get(g.ca), vs = S.get(g.va);
      return g.pts[si].map((p, i) => {
        const v = p.hi;
        if (v == null || i >= cs.n || (vs.log && v <= 0)) return null;
        const c = cs.at(i), y = vs.pos(v);
        return g.va.dir === 'v' ? [c, y] : [y, c];
      });
    }
    function segs(pts, span) {
      const out = []; let cur = [];
      for (const p of pts) { if (p) cur.push(p); else if (!span) { if (cur.length) out.push(cur); cur = []; } }
      if (cur.length) out.push(cur);
      return out;
    }
    function drawLine(g) {
      if (g.hiLow || g.upDown || g.dropLines) drawLineExtras(g);
      g.sers.forEach((s, si) => {
        const pts = catPts(g, si);
        g.pts[si].forEach((p, i) => { p.xy = pts[i]; });
        const st = seriesLine(g, s); if (!st) return;
        let d = '';
        for (const sg of segs(pts, m.blanks === 'span')) d += s.smooth ? smoothD(sg) : lineD(sg);
        dl.path(d, Object.assign({}, st, { join: 'round' }));
      });
    }
    /* Stock and line extras, behind the series: drop lines, high-low lines, up-down bars. */
    function drawLineExtras(g) {
      const cs = S.get(g.ca), vs = S.get(g.va);
      const all = g.sers.map((s, si) => catPts(g, si));
      if (g.dropLines) {
        const st = strokeOf(g.dropLines, { color: { c: '#868686', a: 1 }, w: 0.75 }, k);
        const yb = vs.pos(Math.min(Math.max(baseValue(g), vs.min), vs.max));
        let d = '';
        all.forEach(pts => pts.forEach(p => { if (p) d += `M${r2(p[0])} ${r2(p[1])}V${r2(yb)}`; }));
        if (st) dl.path(d, st);
      }
      if (g.hiLow) {
        const st = strokeOf(g.hiLow, { color: { c: '#595959', a: 1 }, w: 0.75 }, k);
        let d = '';
        for (let i = 0; i < cs.n; i++) {
          const ys = all.map(pts => pts[i]).filter(Boolean).map(p => p[1]);
          if (ys.length > 1) d += `M${r2(cs.at(i))} ${r2(Math.min(...ys))}V${r2(Math.max(...ys))}`;
        }
        if (st) dl.path(d, st);
      }
      if (g.upDown && g.sers.length > 1) {
        const o = g.pts[0], c = g.pts[g.sers.length - 1], bw = cs.band / (1 + g.upDown.gap / 100);
        for (let i = 0; i < cs.n; i++) {
          if (!o[i] || !c[i] || o[i].hi == null || c[i].hi == null) continue;
          const up = c[i].hi >= o[i].hi, sp = up ? g.upDown.up : g.upDown.down;
          const y0 = vs.pos(o[i].hi), y1 = vs.pos(c[i].hi), x = cs.at(i);
          const fill = sp.fill !== undefined ? sp.fill : { c: up ? '#FFFFFF' : '#595959', a: 1 };
          const st = strokeOf(sp.line, { color: { c: '#595959', a: 1 }, w: 0.75 }, k);
          dl.path(rectD(x - bw / 2, Math.min(y0, y1), bw, Math.max(Math.abs(y1 - y0), 0.5 * k)), Object.assign({ fill: fill || null }, st || {}, { join: 'miter' }));
        }
      }
    }
    function drawArea(g) {
      const cs = S.get(g.ca), vs = S.get(g.va);
      const bv = baseValue(g);
      g.sers.forEach((s, si) => {
        const top = [], bot = [];
        g.pts[si].forEach((p, i) => {
          if (i >= cs.n) return;
          const c = cs.at(i);
          const hi = p.hi == null ? (g.stacked ? p.lo || 0 : bv) : p.hi;
          const lo = g.stacked ? (p.lo == null ? 0 : p.lo) : bv;
          const ph = vs.pos(Math.min(Math.max(hi, vs.min), vs.max)), pb = vs.pos(Math.min(Math.max(lo, vs.min), vs.max));
          top.push(g.va.dir === 'v' ? [c, ph] : [ph, c]); bot.push(g.va.dir === 'v' ? [c, pb] : [pb, c]);
          p.xy = top[top.length - 1];
        });
        if (!top.length) return;
        const d = lineD(top.concat(bot.reverse())) + 'Z';
        dl.path(d, Object.assign({ fill: fillFor(g, s, null) || null }, strokeOf(s.line, null, k) || {}, { join: 'round' }));
      });
    }
    function drawScatter(g) {
      const xs = S.get(g.xa), ys = S.get(g.ya);
      g.sers.forEach((s, si) => {
        const pts = g.pts[si].map(p => {
          if (p.x == null || p.y == null) return null;
          if ((xs.log && p.x <= 0) || (ys.log && p.y <= 0)) return null;
          return [xs.pos(p.x), ys.pos(p.y)];
        });
        g.pts[si].forEach((p, i) => { p.xy = pts[i]; });
        const st = seriesLine(g, s);
        if (st) {
          let d = '';
          for (const sg of segs(pts, m.blanks === 'span')) d += (s.smooth || g.scatterStyle === 'smooth' || g.scatterStyle === 'smoothMarker') && s.smooth !== false ? smoothD(sg) : lineD(sg);
          dl.path(d, Object.assign({}, st, { join: 'round' }));
        }
      });
    }
    function drawMarkers(g) {
      if (g.type !== 'line' && g.type !== 'scatter') {
        return;
      }
      const tol = 0.75 * k;
      g.sers.forEach((s, si) => {
        g.pts[si].forEach((p, i) => {
          const xy = p.xy; if (!xy) return;
          if (xy[0] < plot.x - tol || xy[0] > plot.x + plot.w + tol || xy[1] < plot.y - tol || xy[1] > plot.y + plot.h + tol) return;
          const mk = markerFor(g, s, i);
          if (mk) drawMarker(mk, xy[0], xy[1]);
        });
        const D = mergeDL(g.dLbls, s.dLbls);
        if (D && !D.del && (D.val || D.cat || D.ser)) {
          g.pts[si].forEach((p, i) => {
            if (!p.xy || D.hidden.has(i)) return;
            const v = g.type === 'scatter' ? p.y : p.v;
            const cat = g.type === 'scatter' ? fmtNum(p.x, (s.x && s.x.fmt) || 'General') : (g.ca.labels || [])[i];
            const txt = labelText(D, s, i, v, cat, null); if (!txt) return;
            const b = simple(txt, mkFont(base, D.font));
            const mk = markerFor(g, s, i); const ms = mk ? mk.size / 2 : 0; const g2 = 3 * k;
            const pos = D.pos || 'r';
            let x = p.xy[0], y = p.xy[1];
            if (pos === 't') y -= ms + g2 + b.h / 2; else if (pos === 'b') y += ms + g2 + b.h / 2;
            else if (pos === 'l') x -= ms + g2 + b.w / 2; else if (pos === 'ctr') { } else x += ms + g2 + b.w / 2;
            drawBlock(b, x, y, 0);
          });
        }
      });
    }
    function drawErrs(g) {
      g.errs.forEach((list, si) => list.forEach(({ e, dir, amt }) => {
        const s = g.sers[si];
        const st = strokeOf(e.line, { color: { c: '#595959', a: 1 }, w: 0.75 }, k); if (!st) return;
        const cap = e.noCap ? 0 : 3 * k;
        let d = '';
        amt.forEach((a, i) => {
          if (!a) return;
          const p = g.pts[si][i];
          let x, y0, y1, horizontal;
          if (g.xy) {
            const xs = S.get(g.xa), ys = S.get(g.ya);
            if (p.x == null || p.y == null) return;
            if (dir === 'x') { horizontal = true; y0 = xs.pos(xs.log ? Math.max(a.lo, xs.min) : a.lo); y1 = xs.pos(a.hi); x = ys.pos(p.y); }
            else { horizontal = false; y0 = ys.pos(ys.log ? Math.max(a.lo, ys.min) : a.lo); y1 = ys.pos(a.hi); x = xs.pos(p.x); }
          } else {
            const cs = S.get(g.ca), vs = S.get(g.va);
            if (i >= cs.n) return;
            const c = p.cx != null ? p.cx : cs.at(i);
            horizontal = g.va.dir === 'h';
            y0 = vs.pos(vs.log ? Math.max(a.lo, vs.min) : a.lo); y1 = vs.pos(a.hi); x = c;
          }
          if (!horizontal) { d += `M${r2(x)} ${r2(y0)}V${r2(y1)}`; if (cap) { if (a.lo !== a.c) d += `M${r2(x - cap)} ${r2(y0)}H${r2(x + cap)}`; if (a.hi !== a.c) d += `M${r2(x - cap)} ${r2(y1)}H${r2(x + cap)}`; } }
          else { d += `M${r2(y0)} ${r2(x)}H${r2(y1)}`; if (cap) { if (a.lo !== a.c) d += `M${r2(y0)} ${r2(x - cap)}V${r2(x + cap)}`; if (a.hi !== a.c) d += `M${r2(y1)} ${r2(x - cap)}V${r2(x + cap)}`; } }
        });
        dl.path(d, st);
      }));
    }
    function drawTrends(g) {
      g.fits.forEach((list, si) => list.forEach(({ t, fit }) => {
        if (!fit) return;
        const s = g.sers[si];
        const st = strokeOf(t.line, { color: lineColorFor(s), w: 1.5, dash: 'sysDot' }, k); if (!st) return;
        let xs, ys, toXY;
        if (g.xy) { xs = S.get(g.xa); ys = S.get(g.ya); toXY = (x, y) => [xs.pos(x), ys.pos(y)]; }
        else { const cs = S.get(g.ca), vs = S.get(g.va); ys = vs; xs = null; toXY = (x, y) => { const c = cs.a1 + ((cs.between ? x - 0.5 : x - 1) / (cs.between ? cs.n : Math.max(cs.n - 1, 1))) * (cs.a2 - cs.a1); const v = vs.pos(y); return g.va.dir === 'v' ? [c, v] : [v, c]; }; }
        let pts = [];
        if (fit.pts) pts = fit.pts.map(([x, y]) => (ys.log && y <= 0) ? null : toXY(x, y)).filter(Boolean);
        else {
          let x0 = fit.xmin, x1 = fit.xmax;
          if (xs && xs.log) { x0 = Math.max(x0, 1e-300); }
          const N = fit.kind === 'linear' && !(xs && xs.log) && !ys.log ? 1 : 160;
          for (let j = 0; j <= N; j++) {
            const x = xs && xs.log ? Math.exp(Math.log(x0) + (Math.log(x1) - Math.log(x0)) * j / N) : x0 + (x1 - x0) * j / N;
            if ((fit.kind === 'log' || fit.kind === 'power') && x <= 0) continue;
            const y = fit.f(x);
            if (!isFinite(y) || (ys.log && y <= 0)) continue;
            pts.push(toXY(x, y));
          }
        }
        if (pts.length < 2) return;
        dl.path(lineD(pts), st);
        if ((t.dispEq || t.dispR2) && fit.c) {
          const f = mkFont(base, t.lblFont);
          const lines = [];
          if (t.dispEq) lines.push(eqRuns(fit, t.lblFmt).map(r => ({ text: r.text, f: r.sup ? { baseline: 0.3 } : {} })));
          if (t.dispR2) lines.push([{ text: 'R', f: {} }, { text: '2', f: { baseline: 0.3 } }, { text: ' = ' + locNum(String(parseFloat(fit.r2.toFixed(4)))), f: {} }]);
          const b = block(lines, f);
          const end = pts[pts.length - 1];
          let cx = end[0] - b.w / 2 - 2 * k, cy = end[1] - b.h / 2 - 8 * k;
          cx = Math.min(Math.max(cx, plot.x + b.w / 2 + 2 * k), plot.x + plot.w - b.w / 2 - 2 * k);
          cy = Math.min(Math.max(cy, plot.y + b.h / 2 + 2 * k), plot.y + plot.h - b.h / 2 - 2 * k);
          const lay = t.lblLayout;
          if (lay && lay.x != null && lay.y != null) {
            if (lay.xMode === 'edge') cx = lay.x * W + b.w / 2; else cx += lay.x * W;
            if (lay.yMode === 'edge') cy = lay.y * H + b.h / 2; else cy += lay.y * H;
          }
          labelsToDraw.push({ b, x: cx, y: cy });
        }
      }));
    }
  }
}

/* ===== Back ends ===== */
function cssColor(c) { if (!c) return 'none'; if (c.a == null || c.a >= 1) return c.c; const [r, g, b] = hexToRgb(c.c); return `rgba(${r},${g},${b},${r2(c.a)})`; }
const SERIF_RE = /times|cambria|georgia|garamond|book antiqua|palatino|serif|minion/i;
function fontStack(fam) {
  const f = (fam || 'Calibri').replace(/["']/g, '');
  const serif = SERIF_RE.test(f);
  const tail = serif ? '"Times New Roman", Tinos, Times, serif' : 'Calibri, Carlito, Arial, Helvetica, sans-serif';
  return `"${f}", ${tail}`;
}
function cssFont(f, size) { return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${r2(size)}px ${fontStack(f.family)}`; }
function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
let SVG_UID = 0;
function toSVG(items, W, H, attrs) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" ${attrs || ''} viewBox="0 0 ${r2(W)} ${r2(H)}" xml:space="preserve">`];
  let cid = 0;
  const paint = (key, c) => { if (!c) return ` ${key}="none"`; let s = ` ${key}="${c.c}"`; if (c.a != null && c.a < 1) s += ` ${key}-opacity="${r2(c.a)}"`; return s; };
  for (const p of items) {
    if (p.t === 'path') {
      let s = `<path d="${p.d}"` + paint('fill', p.fill);
      if (p.fill && p.evenodd) s += ' fill-rule="evenodd"';
      if (p.stroke) {
        s += paint('stroke', p.stroke) + ` stroke-width="${r2(p.sw)}"`;
        if (p.dash) s += ` stroke-dasharray="${p.dash.map(r2).join(' ')}"`;
        if (p.cap && p.cap !== 'butt') s += ` stroke-linecap="${p.cap}"`;
        s += ` stroke-linejoin="${p.join || 'round'}"`;
      }
      out.push(s + '/>');
    } else if (p.t === 'text') {
      out.push(`<g transform="translate(${r2(p.x)} ${r2(p.y)})${p.rot ? ` rotate(${r2(p.rot)})` : ''}">`);
      for (const ln of p.items) {
        let t = `<text x="0" y="${r2(ln.y)}" text-anchor="${toSVG.absolute ? "start" : "middle"}" style="white-space:pre">`, cur = 0, ax = -ln.w / 2;
        for (const r of ln.runs) {
          const f = r.f, dy = r.shift - cur; cur = r.shift;
          const pos = toSVG.absolute ? ` x="${r2(ax)}" text-anchor="start"` : ''; ax += r.w;
          t += `<tspan${pos}${dy ? ` dy="${r2(dy)}"` : ''} font-family="${escXml(fontStack(f.family))}" font-size="${r2(r.size)}"${f.bold ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}${paint('fill', f.color || TEXT_GREY)}>${escXml(r.text)}</tspan>`;
        }
        out.push(t + '</text>');
      }
      out.push('</g>');
    } else if (p.t === 'clip') {
      cid = ++SVG_UID;
      out.push(`<clipPath id="cp${cid}"><rect x="${r2(p.x)}" y="${r2(p.y)}" width="${r2(p.w)}" height="${r2(p.h)}"/></clipPath><g clip-path="url(#cp${cid})">`);
    } else if (p.t === 'unclip') out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}
function toCanvas(ctx, items, scale) {
  ctx.save(); ctx.scale(scale, scale);
  for (const p of items) {
    if (p.t === 'path') {
      const path = new Path2D(p.d);
      if (p.fill) { ctx.fillStyle = cssColor(p.fill); ctx.fill(path, p.evenodd ? 'evenodd' : 'nonzero'); }
      if (p.stroke) {
        ctx.strokeStyle = cssColor(p.stroke); ctx.lineWidth = p.sw; ctx.setLineDash(p.dash || []);
        ctx.lineCap = p.cap || 'butt'; ctx.lineJoin = p.join || 'round'; ctx.miterLimit = 4; ctx.stroke(path);
      }
    } else if (p.t === 'text') {
      ctx.save(); ctx.translate(p.x, p.y); if (p.rot) ctx.rotate(p.rot * Math.PI / 180);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      for (const ln of p.items) {
        const ws = ln.runs.map(r => { ctx.font = cssFont(r.f, r.size); return ctx.measureText(r.text).width; });
        let x = -ws.reduce((a, b) => a + b, 0) / 2;
        ln.runs.forEach((r, i) => { ctx.font = cssFont(r.f, r.size); ctx.fillStyle = cssColor(r.f.color || TEXT_GREY); ctx.fillText(r.text, x, ln.y + r.shift); x += ws[i]; });
      }
      ctx.restore();
    } else if (p.t === 'clip') { ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip(); }
    else if (p.t === 'unclip') ctx.restore();
  }
  ctx.restore();
}

/* ===== PDF back end =====
   One vector page, sized to the chart, for LaTeX and journals. Text stays
   text, in an embedded subset of a font with Excel's letter widths: Carlito
   for Calibri (and any other sans), Arimo for Arial and Helvetica, Tinos for
   Times. The page fetches the font files (pdfFaces lists them) and hands them
   in parsed; only the letters a chart uses go into the file, so a PDF is tens
   of kilobytes. Written as PDF 1.4, which pdfLaTeX includes without a warning. */
const PDF_FONT_CDN = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/';
const PDF_FAMILIES = { Carlito: 'carlito@0.4.1', Arimo: 'arimo@0.4.3', Tinos: 'tinos@0.4.2' };
function pdfFace(f) {
  const fam = (f.family || 'Calibri').replace(/["']/g, '');
  const name = SERIF_RE.test(fam) ? 'Tinos' : /arial|helvetica|arimo|liberation sans/i.test(fam) ? 'Arimo' : 'Carlito';
  const style = (f.bold ? '700Bold' : '400Regular') + (f.italic ? '_Italic' : '');
  const key = `${name}_${style}`;
  return { key, serif: name === 'Tinos', url: `${PDF_FONT_CDN}${PDF_FAMILIES[name]}/${style}/${key}.ttf` };
}
function pdfFaces(items) {
  const out = new Map();
  for (const p of items) if (p.t === 'text') for (const ln of p.items) for (const r of ln.runs) { const fc = pdfFace(r.f); out.set(fc.key, fc); }
  return [...out.values()];
}

/* TrueType: just enough of the file to map letters to glyphs, measure them
   and cut out a subset. */
function parseTTF(buf) {
  const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const T = {};
  for (let i = 0, n = v.getUint16(4); i < n; i++) {
    const o = 12 + 16 * i, at = v.getUint32(o + 8);
    T[String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])] = b.subarray(at, at + v.getUint32(o + 12));
  }
  if (!T.glyf || !T.loca || !T.cmap || !T.hmtx) throw new Error('Not a TrueType font');
  const dv = t => new DataView(t.buffer, t.byteOffset, t.byteLength);
  const head = dv(T.head), hhea = dv(T.hhea), hm = dv(T.hmtx), lv = dv(T.loca);
  const n = dv(T.maxp).getUint16(4), nhm = hhea.getUint16(34), long = head.getInt16(50) === 1;
  const adv = new Uint16Array(n), lsb = new Int16Array(n), loca = new Uint32Array(n + 1);
  for (let g = 0; g < n; g++) {
    adv[g] = hm.getUint16(4 * Math.min(g, nhm - 1));
    lsb[g] = g < nhm ? hm.getInt16(4 * g + 2) : hm.getInt16(4 * nhm + 2 * (g - nhm));
  }
  for (let g = 0; g <= n; g++) loca[g] = long ? lv.getUint32(4 * g) : lv.getUint16(2 * g) * 2;
  const os2 = T['OS/2'] && dv(T['OS/2']), post = T.post && dv(T.post);
  const ascent = hhea.getInt16(4);
  return {
    T, n, adv, lsb, loca, cmap: readCmap(dv(T.cmap)), upm: head.getUint16(18),
    name: psName(T.name) || 'Font',
    bbox: [head.getInt16(36), head.getInt16(38), head.getInt16(40), head.getInt16(42)],
    ascent, descent: hhea.getInt16(6),
    capHeight: os2 && os2.getUint16(0) >= 2 ? os2.getInt16(88) : Math.round(ascent * 0.7),
    italicAngle: post ? post.getInt32(4) / 65536 : 0,
    fixed: post ? post.getUint32(12) !== 0 : false,
    bold: (head.getUint16(44) & 1) !== 0
  };
}
function readCmap(v) {
  let f4 = -1, f12 = -1;
  for (let i = 0, n = v.getUint16(2); i < n; i++) {
    const pid = v.getUint16(4 + 8 * i), eid = v.getUint16(6 + 8 * i), at = v.getUint32(8 + 8 * i), fmt = v.getUint16(at);
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) f12 = at;
    else if (fmt === 4 && (pid === 0 || (pid === 3 && eid <= 1))) f4 = at;
  }
  const map = new Map();
  if (f12 >= 0) {
    for (let i = 0, n = v.getUint32(f12 + 12); i < n; i++) {
      const o = f12 + 16 + 12 * i, s = v.getUint32(o), e = Math.min(v.getUint32(o + 4), s + 0xFFFF), g = v.getUint32(o + 8);
      for (let c = s; c <= e; c++) map.set(c, g + c - s);
    }
  } else if (f4 >= 0) {
    const seg2 = v.getUint16(f4 + 6), ends = f4 + 14, starts = ends + seg2 + 2, deltas = starts + seg2, ranges = deltas + seg2;
    for (let i = 0; i < seg2; i += 2) {
      const e = v.getUint16(ends + i), s = v.getUint16(starts + i), d = v.getUint16(deltas + i), ro = v.getUint16(ranges + i);
      for (let c = s; c <= e && c < 0xFFFF; c++) {
        let g = ro ? v.getUint16(ranges + i + ro + 2 * (c - s)) : c;
        if (g) g = (g + d) & 0xFFFF;
        if (g) map.set(c, g);
      }
    }
  }
  return map;
}
function psName(t) {
  if (!t) return null;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength), base = v.getUint16(4);
  for (let i = 0, n = v.getUint16(2); i < n; i++) {
    const o = 6 + 12 * i, pid = v.getUint16(o), len = v.getUint16(o + 8), at = base + v.getUint16(o + 10);
    if (v.getUint16(o + 6) !== 6) continue;
    let s = '';
    if (pid === 1) for (let j = 0; j < len; j++) s += String.fromCharCode(t[at + j]);
    else for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(v.getUint16(at + j));
    s = s.replace(/[^\x21-\x7e]|[[\](){}<>/%#]/g, '');
    if (s) return s;
  }
  return null;
}
/* A font holding only glyphs `gids` (0 first), renumbered in that order. A
   composite glyph (an accented letter, say) is built from other glyphs, which
   come along at the end. */
function subsetTTF(F, gids) {
  const order = gids.slice(), map = new Map(order.map((g, i) => [g, i]));
  const src = F.T.glyf, sv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  function parts(g, cb) {
    const s = F.loca[g];
    if (F.loca[g + 1] - s < 10 || sv.getInt16(s) >= 0) return;
    let p = s + 10, fl;
    do {
      fl = sv.getUint16(p); cb(p + 2 - s, sv.getUint16(p + 2));
      p += 4 + (fl & 1 ? 4 : 2) + (fl & 8 ? 2 : fl & 0x40 ? 4 : fl & 0x80 ? 8 : 0);
    } while (fl & 0x20);
  }
  for (let i = 0; i < order.length; i++) parts(order[i], (at, g) => { if (!map.has(g)) { map.set(g, order.length); order.push(g); } });
  const n = order.length, loca = new Uint8Array(4 * (n + 1)), lv = new DataView(loca.buffer);
  const hmtx = new Uint8Array(4 * n), hv = new DataView(hmtx.buffer);
  let size = 0;
  for (const g of order) size += (F.loca[g + 1] - F.loca[g] + 3) & ~3;
  const glyf = new Uint8Array(size), gv = new DataView(glyf.buffer);
  let at = 0;
  order.forEach((g, i) => {
    const s = F.loca[g], e = F.loca[g + 1];
    lv.setUint32(4 * i, at);
    glyf.set(src.subarray(s, e), at);
    parts(g, (off, old) => gv.setUint16(at + off, map.get(old)));
    hv.setUint16(4 * i, F.adv[g]); hv.setInt16(4 * i + 2, F.lsb[g]);
    at += (e - s + 3) & ~3;
  });
  lv.setUint32(4 * n, at);
  const copy = (tag, edit) => { const t = F.T[tag].slice(); if (edit) edit(new DataView(t.buffer)); return t; };
  const tables = {
    head: copy('head', d => { d.setUint32(8, 0); d.setInt16(50, 1); }),
    hhea: copy('hhea', d => d.setUint16(34, n)),
    maxp: copy('maxp', d => d.setUint16(4, n)),
    loca, glyf, hmtx
  };
  for (const tag of ['cvt ', 'fpgm', 'prep']) if (F.T[tag]) tables[tag] = F.T[tag];
  return { bytes: sfnt(tables), order };
}
function ttfSum(d) {
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s = (s + ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3])) >>> 0;
  return s;
}
function sfnt(tables) {
  const tags = Object.keys(tables).sort(), n = tags.length;
  let es = 0; while ((2 << es) <= n) es++;
  let size = 12 + 16 * n;
  for (const t of tags) size += (tables[t].length + 3) & ~3;
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000); v.setUint16(4, n); v.setUint16(6, 16 << es); v.setUint16(8, es); v.setUint16(10, 16 * n - (16 << es));
  let at = 12 + 16 * n, headAt = 0;
  tags.forEach((t, i) => {
    const d = tables[t], o = 12 + 16 * i;
    for (let j = 0; j < 4; j++) out[o + j] = t.charCodeAt(j);
    v.setUint32(o + 4, ttfSum(d)); v.setUint32(o + 8, at); v.setUint32(o + 12, d.length);
    if (t === 'head') headAt = at;
    out.set(d, at); at += (d.length + 3) & ~3;
  });
  v.setUint32(headAt + 8, (0xB1B0AFBA - ttfSum(out)) >>> 0);
  return out;
}

/* SVG path data to PDF path operators. Arcs become Béziers. */
const pn = (v, d = 2) => { const m = 10 ** d, r = Math.round(v * m) / m; return Object.is(r, -0) ? '0' : String(r); };
function arcBeziers(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const a = phi * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = co * dx + si * dy, yp = -si * dx + co * dy;
  const lam = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = f * rx * yp / ry, cyp = -f * ry * xp / rx;
  const cx = co * cxp - si * cyp + (x1 + x2) / 2, cy = si * cxp + co * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry;
  let t = ang(1, 0, ux, uy), dt = ang(ux, uy, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), step = dt / segs, k = 4 / 3 * Math.tan(step / 4);
  const P = (u, w) => [cx + rx * u * co - ry * w * si, cy + rx * u * si + ry * w * co];
  const out = [];
  for (let i = 0; i < segs; i++, t += step) {
    const c0 = Math.cos(t), s0 = Math.sin(t), c1 = Math.cos(t + step), s1 = Math.sin(t + step);
    out.push([...P(c0 - k * s0, s0 + k * c0), ...P(c1 + k * s1, s1 - k * c1), ...P(c1, s1)]);
  }
  out[out.length - 1][4] = x2; out[out.length - 1][5] = y2;
  return out;
}
function pdfPath(d) {
  const tok = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out = [], P = (x, y) => `${pn(x)} ${pn(y)}`;
  let i = 0, cmd = '', last = '', x = 0, y = 0, sx = 0, sy = 0, kx = 0, ky = 0;
  const num = () => +tok[i++];
  const curve = (x1, y1, x2, y2, x3, y3) => { out.push(`${P(x1, y1)} ${P(x2, y2)} ${P(x3, y3)} c`); kx = x2; ky = y2; x = x3; y = y3; };
  const quad = (qx, qy, x3, y3) => { curve(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x3 + 2 / 3 * (qx - x3), y3 + 2 / 3 * (qy - y3), x3, y3); kx = qx; ky = qy; };
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) cmd = tok[i++];
    else if (!cmd) { i++; continue; }
    const C = cmd.toUpperCase(), ox = cmd === C ? 0 : x, oy = cmd === C ? 0 : y;
    if (C !== 'Z' && i >= tok.length) break;
    switch (C) {
      case 'M': x = sx = ox + num(); y = sy = oy + num(); out.push(P(x, y) + ' m'); cmd = cmd === 'M' ? 'L' : 'l'; break;
      case 'L': x = ox + num(); y = oy + num(); out.push(P(x, y) + ' l'); break;
      case 'H': x = ox + num(); out.push(P(x, y) + ' l'); break;
      case 'V': y = oy + num(); out.push(P(x, y) + ' l'); break;
      case 'C': { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; curve(...a); break; }
      case 'S': { const r = /[CS]/.test(last) ? [2 * x - kx, 2 * y - ky] : [x, y]; const a = [ox + num(), oy + num(), ox + num(), oy + num()]; curve(r[0], r[1], ...a); break; }
      case 'Q': { const a = [ox + num(), oy + num(), ox + num(), oy + num()]; quad(...a); break; }
      case 'T': { const q = /[QT]/.test(last) ? [2 * x - kx, 2 * y - ky] : [x, y]; quad(q[0], q[1], ox + num(), oy + num()); break; }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), lg = num(), sw = num(), ex = ox + num(), ey = oy + num();
        for (const b of arcBeziers(x, y, rx, ry, rot, lg, sw, ex, ey)) curve(...b);
        x = ex; y = ey; break;
      }
      case 'Z': out.push('h'); x = sx; y = sy; cmd = ''; break;
      default: cmd = '';
    }
    last = C;
  }
  return out.join('\n');
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
  catch (e) { return null; }
}
const latin1 = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const utf16hex = cp => cp > 0xFFFF ? hex4(0xD800 + ((cp - 0x10000) >> 10)) + hex4(0xDC00 + ((cp - 0x10000) & 0x3FF)) : hex4(cp);
function pdfString(s) {
  s = String(s);
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, '\\$&') + ')';
  let h = 'FEFF'; for (const ch of s) h += utf16hex(ch.codePointAt(0));
  return `<${h}>`;
}
const pdfRGB = c => hexToRgb(c.c).map(v => pn(v / 255, 3)).join(' ');

/* `fonts` maps each pdfFaces key to its parseTTF result. Returns the bytes. */
async function toPDF(items, W, H, opt) {
  const c = [`1 0 0 -1 0 ${pn(H)} cm`, '4 M'];   // y runs down, as in the display list
  const faces = new Map(), alphas = new Map();
  let st = {}; const saved = [];
  const push = () => { c.push('q'); saved.push(st); st = Object.assign({}, st); };
  const pop = () => { c.push('Q'); st = saved.pop() || {}; };
  const set = (key, val, op) => { if (st[key] !== val) { st[key] = val; c.push(op); } };
  const alpha = (fa, sa) => {
    const key = `${pn(fa)} ${pn(sa)}`;
    if ((st.gs || '1 1') === key) return;
    if (!alphas.has(key)) alphas.set(key, 'G' + alphas.size);
    st.gs = key; c.push(`/${alphas.get(key)} gs`);
  };
  const aOf = col => col.a == null ? 1 : col.a;
  function face(f) {
    const fc = pdfFace(f);
    let u = faces.get(fc.key);
    if (!u) {
      const F = opt.fonts.get(fc.key);
      if (!F) throw new Error('Font not loaded: ' + fc.key);
      u = { F, fc, res: 'F' + (faces.size + 1), cid: new Map([[0, 0]]), gids: [0], uni: [0], w: g => Math.round(F.adv[g] * 1000 / F.upm) };
      faces.set(fc.key, u);
    }
    return u;
  }
  for (const p of items) {
    if (p.t === 'path') {
      const fill = p.fill && aOf(p.fill) > 0 ? p.fill : null, stroke = p.stroke && aOf(p.stroke) > 0 && p.sw > 0 ? p.stroke : null;
      if (!fill && !stroke) continue;
      const ops = pdfPath(p.d); if (!ops) continue;
      alpha(fill ? aOf(fill) : 1, stroke ? aOf(stroke) : 1);
      if (fill) set('fc', fill.c, pdfRGB(fill) + ' rg');
      if (stroke) {
        set('sc', stroke.c, pdfRGB(stroke) + ' RG');
        set('w', pn(p.sw, 3), pn(p.sw, 3) + ' w');
        set('J', p.cap || 'butt', ({ butt: 0, round: 1, square: 2 }[p.cap] || 0) + ' J');
        set('j', p.join || 'round', ({ miter: 0, round: 1, bevel: 2 }[p.join || 'round']) + ' j');
        const dash = p.dash && p.dash.length ? p.dash.map(v => pn(v, 3)).join(' ') : '';
        set('d', dash, `[${dash}] 0 d`);
      }
      c.push(ops, fill && stroke ? (p.evenodd ? 'B*' : 'B') : fill ? (p.evenodd ? 'f*' : 'f') : 'S');
    } else if (p.t === 'text') {
      const a = (p.rot || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      push();
      c.push(`${pn(co, 5)} ${pn(si, 5)} ${pn(-si, 5)} ${pn(co, 5)} ${pn(p.x)} ${pn(p.y)} cm`, 'BT');
      for (const ln of p.items) {
        const runs = ln.runs.map(r => {
          const u = face(r.f); let hex = '', w = 0;
          for (const ch of r.text) {
            const cp = ch.codePointAt(0), g = u.F.cmap.get(cp) || 0;
            let id = u.cid.get(g);
            if (id === undefined) { id = u.gids.length; u.cid.set(g, id); u.gids.push(g); u.uni.push(cp); }
            hex += hex4(id); w += u.w(g);
          }
          return { r, u, hex, w: w / 1000 * r.size };
        });
        let x = -runs.reduce((s, q) => s + q.w, 0) / 2;
        for (const q of runs) {
          if (q.hex && q.r.size > 0) {
            const col = q.r.f.color || TEXT_GREY;
            alpha(aOf(col), st.gs ? +st.gs.split(' ')[1] : 1);
            set('fc', col.c, pdfRGB(col) + ' rg');
            c.push(`/${q.u.res} ${pn(q.r.size, 3)} Tf 1 0 0 -1 ${pn(x, 3)} ${pn(ln.y + q.r.shift, 3)} Tm <${q.hex}> Tj`);
          }
          x += q.w;
        }
      }
      c.push('ET');
      pop();
    } else if (p.t === 'clip') {
      push();
      c.push(`${pn(p.x)} ${pn(p.y)} ${pn(p.w)} ${pn(p.h)} re W n`);
    } else if (p.t === 'unclip' && saved.length) pop();
  }
  while (saved.length) pop();

  /* Objects: 1 catalog, 2 pages, 3 page, 4 info, 5 content, then the fonts. */
  const objs = [];
  const obj = (body, stream) => { objs.push({ body, stream }); return objs.length; };
  async function streamObj(dict, bytes) {
    const z = await deflate(bytes);
    return obj(`<< ${dict}${z ? ' /Filter /FlateDecode' : ''} /Length ${(z || bytes).length} >>`, z || bytes);
  }
  for (let i = 0; i < 4; i++) obj('');
  await streamObj('', latin1(c.join('\n')));
  const fontRes = [];
  for (const u of faces.values()) {
    const F = u.F, sub = subsetTTF(F, u.gids), s = v => Math.round(v * 1000 / F.upm);
    let h = crc32(latin1(u.fc.key + sub.order.join(','))), tag = '';
    for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + h % 26); h = Math.floor(h / 26); }
    const base = `/${tag}+${F.name}`;
    const file = await streamObj(`/Length1 ${sub.bytes.length}`, sub.bytes);
    const flags = (F.fixed ? 1 : 0) | (u.fc.serif ? 2 : 0) | 4 | (F.italicAngle ? 64 : 0);
    const desc = obj(`<< /Type /FontDescriptor /FontName ${base} /Flags ${flags} /FontBBox [${F.bbox.map(s).join(' ')}] /ItalicAngle ${pn(F.italicAngle)} /Ascent ${s(F.ascent)} /Descent ${s(F.descent)} /CapHeight ${s(F.capHeight)} /StemV ${F.bold ? 140 : 80} /FontFile2 ${file} 0 R >>`);
    const cid = obj(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /W [0 [${sub.order.map(u.w).join(' ')}]] /CIDToGIDMap /Identity >>`);
    const map = [];
    for (let i = 1; i < u.uni.length; i++) if (u.gids[i]) map.push(`<${hex4(i)}> <${utf16hex(u.uni[i])}>`);
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < map.length; i += 100) { const part = map.slice(i, i + 100); cmap += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const toUni = await streamObj('', latin1(cmap));
    const font = obj(`<< /Type /Font /Subtype /Type0 /BaseFont ${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
    fontRes.push(`/${u.res} ${font} 0 R`);
  }
  const res = [];
  if (fontRes.length) res.push(`/Font << ${fontRes.join(' ')} >>`);
  if (alphas.size) res.push(`/ExtGState << ${[...alphas].map(([k, n]) => { const [ca, CA] = k.split(' '); return `/${n} << /Type /ExtGState /ca ${ca} /CA ${CA} >>`; }).join(' ')} >>`);
  const now = new Date(), two = n => String(n).padStart(2, '0');
  const date = `D:${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  objs[0].body = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1].body = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[2].body = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pn(W)} ${pn(H)}] /Resources << ${res.join(' ')} /ProcSet [/PDF /Text] >> /Contents 5 0 R >>`;
  objs[3].body = `<< ${opt.title ? `/Title ${pdfString(opt.title)} ` : ''}/Creator (Figura) /Producer (Figura) /CreationDate (${date}) >>`;

  const chunks = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')], xref = [];
  let pos = chunks[0].length;
  const put = b => { chunks.push(b); pos += b.length; };
  objs.forEach((o, i) => {
    xref.push(pos);
    put(latin1(`${i + 1} 0 obj\n${o.body}\n`));
    if (o.stream) { put(latin1('stream\n')); put(o.stream); put(latin1('\nendstream\n')); }
    put(latin1('endobj\n'));
  });
  const id = [0, 1, 2, 3].map(i => crc32(latin1(i + date + c.length + (opt.title || ''))).toString(16).padStart(8, '0')).join('');
  put(latin1(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}` +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 4 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${pos}\n%%EOF\n`));
  const out = new Uint8Array(pos); let o = 0;
  for (const b of chunks) { out.set(b, o); o += b.length; }
  return out;
}

/* ===== Resolution metadata ===== */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngSetDpi(buf, dpi) {
  const src = new Uint8Array(buf);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [src.subarray(0, 8)];
  let p = 8, inserted = false;
  const sv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  while (p + 8 <= src.length) {
    const len = sv.getUint32(p);
    const type = String.fromCharCode(src[p + 4], src[p + 5], src[p + 6], src[p + 7]);
    const end = p + 12 + len;
    if (type !== 'pHYs') parts.push(src.subarray(p, end));
    if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    p = end;
  }
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total); let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return out;
}
function jpegSetDpi(buf, dpi) {
  const src = new Uint8Array(buf);
  const d = Math.min(65535, Math.round(dpi));
  if (src[0] !== 0xFF || src[1] !== 0xD8) return src;
  if (src[2] === 0xFF && src[3] === 0xE0 && String.fromCharCode(src[6], src[7], src[8], src[9]) === 'JFIF') {
    const out = src.slice();
    out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  const out = new Uint8Array(src.length + app0.length);
  out.set(src.subarray(0, 2), 0); out.set(app0, 2); out.set(src.subarray(2), 2 + app0.length);
  return out;
}

/* ===== TIFF =====
   RGB, or RGBA when transparent, in LZW-compressed strips: the kind of TIFF
   journals ask for. `rows(y, n)` returns n rows of RGBA pixels from row y. */
const LZW_TAB = { stamp: null, code: null, gen: 0 };
function lzw(data) {
  if (!LZW_TAB.stamp) { LZW_TAB.stamp = new Int32Array(1 << 20); LZW_TAB.code = new Uint16Array(1 << 20); }
  const stamp = LZW_TAB.stamp, codes = LZW_TAB.code;
  let out = new Uint8Array(Math.max(4096, data.length >> 2)), o = 0, acc = 0, bits = 0;
  const put = (code, n) => {
    acc = (acc << n) | code; bits += n;
    while (bits >= 8) {
      bits -= 8;
      if (o === out.length) { const b = new Uint8Array(out.length * 2); b.set(out); out = b; }
      out[o++] = (acc >>> bits) & 255;
    }
    acc &= (1 << bits) - 1;
  };
  // Codes widen one entry early (TIFF's rule) and the table restarts at 4094.
  let gen = ++LZW_TAB.gen, next = 258, width = 9;
  const grow = () => {
    if (++next === 4094) { put(256, width); gen = ++LZW_TAB.gen; next = 258; width = 9; }
    else if (next > (1 << width) - 1) width++;
  };
  put(256, 9);
  if (data.length) {
    let w = data[0];
    for (let i = 1; i < data.length; i++) {
      const key = (w << 8) | data[i];
      if (stamp[key] === gen) { w = codes[key]; continue; }
      put(w, width);
      stamp[key] = gen; codes[key] = next;
      grow();
      w = data[i];
    }
    put(w, width);
    grow();
  }
  put(257, width);
  if (bits) put(0, 8 - bits);
  return out.subarray(0, o);
}
function encodeTIFF(w, h, dpi, alpha, rows) {
  const spp = alpha ? 4 : 3, rowBytes = w * spp;
  const rps = Math.max(1, Math.min(h, Math.floor(65536 / rowBytes)));
  const strips = [];
  for (let y = 0; y < h; y += rps) {
    const n = Math.min(rps, h - y), px = rows(y, n);
    let raw;
    if (alpha) raw = new Uint8Array(px.buffer, px.byteOffset, n * rowBytes);
    else {
      raw = new Uint8Array(n * rowBytes);
      for (let i = 0, j = 0; j < raw.length; i += 4) { raw[j++] = px[i]; raw[j++] = px[i + 1]; raw[j++] = px[i + 2]; }
    }
    strips.push(lzw(raw));
  }
  const offs = [];
  let at = 8;
  for (const s of strips) { offs.push(at); at += s.length; }
  const res = [Math.round(dpi), 1];
  const tags = [
    [256, 4, [w]], [257, 4, [h]], [258, 3, Array(spp).fill(8)], [259, 3, [5]], [262, 3, [2]],
    [273, 4, offs], [277, 3, [spp]], [278, 4, [rps]], [279, 4, strips.map(s => s.length)],
    [282, 5, res], [283, 5, res], [284, 3, [1]], [296, 3, [2]],
    [305, 2, Array.from(latin1('Figura\0'))]
  ];
  if (alpha) tags.push([338, 3, [2]]);
  const SIZE = { 2: 1, 3: 2, 4: 4, 5: 4 };
  const ifd = (at + 1) & ~1;
  let extra = ifd + 2 + 12 * tags.length + 4, end = extra;
  for (const [, type, vals] of tags) { const len = vals.length * SIZE[type]; if (len > 4) end += (len + 1) & ~1; }
  const out = new Uint8Array(end), v = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]); v.setUint32(4, ifd, true);
  strips.forEach((s, i) => out.set(s, offs[i]));
  v.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, type, vals], i) => {
    const e = ifd + 2 + 12 * i, len = vals.length * SIZE[type];
    v.setUint16(e, tag, true); v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, type === 5 ? vals.length / 2 : vals.length, true);
    let p = e + 8;
    if (len > 4) { v.setUint32(p, extra, true); p = extra; extra += (len + 1) & ~1; }
    for (const x of vals) {
      if (type === 2) out[p++] = x;
      else if (type === 3) { v.setUint16(p, x, true); p += 2; }
      else { v.setUint32(p, x, true); p += 4; }
    }
  });
  return out;
}


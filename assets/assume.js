/* Unit Headroom Tracker, ASSUME view: hour-by-hour capacity of a PowerPlant or Storage
 * as market orders are accepted. Arithmetic lives in model.js, examples in examples.js. */
(() => {
  'use strict';
  const M = window.UHTModel, EXAMPLES = window.ASSUME_EXAMPLES, FIX = window.ASSUME_FIXTURES, UP = window.UHTUpstream, TC = window.UHTTestCode;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const STORE_KEY = 'unit-headroom-tracker:assume:v1';
  const REPO = `https://github.com/${UP.REPO}/blob/${UP.PINNED}/`;
  const EPS = 1e-6;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const num = M.num;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, dp = 2) => {
    if (v == null || !Number.isFinite(v)) return '–';
    const f = Math.pow(10, dp);
    let r = Math.round(v * f) / f;
    if (Object.is(r, -0)) r = 0;
    return r.toLocaleString('en-US', { maximumFractionDigits: dp });
  };
  const paren = v => (v < 0 ? `(${fmt(v)})` : fmt(v));
  const PRODUCTS = ['energy', 'capacity_pos', 'capacity_neg'];
  const UNIT_FIELDS = {
    storage: ['max_power_charge', 'max_power_discharge', 'min_power_charge', 'min_power_discharge', 'capacity', 'initial_soc', 'min_soc', 'max_soc',
      'efficiency_charge', 'efficiency_discharge', 'ramp_up_charge', 'ramp_down_charge', 'ramp_up_discharge', 'ramp_down_discharge'],
    plant: ['max_power', 'min_power', 'ramp_up', 'ramp_down', 'min_operating_time', 'min_down_time'],
  };
  const RAMP_FIELDS = new Set(['ramp_up_charge', 'ramp_down_charge', 'ramp_up_discharge', 'ramp_down_discharge', 'ramp_up', 'ramp_down']);

  // ------------------------------------------------------------------ state
  const defaultOpts = () => ({ initial_previous_power: 0, execute: false, freq_h: 1 });
  const defaultCode = () => ({ open: true, tab: 'assume', name: '', asserts: { before: true, after: true, ramp: false, op: false, soc: true, exec: true } });
  function scenarioFromExample(ex) {
    const markets = ex.markets.map(([name, product], i) => ({ id: uid(), name, product, slot: i % 8 }));
    const steps = ex.bids.map((row, t) => ({
      availability: ex.availability ? ex.availability[t] : 1,
      bids: Object.fromEntries(row.map((b, j) => [markets[j].id, b == null ? null : Array.isArray(b) ? { v: String(b[0]), on: b[1] !== false } : { v: String(b), on: true }]).filter(([, b]) => b)),
    }));
    return { unit: { ...FIX[ex.kind], ...ex.unit }, opts: { ...defaultOpts(), ...(ex.opts || {}) }, markets, steps, sel: 0 };
  }
  function blankScenario(kind) {
    const markets = [{ id: uid(), name: 'EOM', product: 'energy', slot: 0 }];
    return { unit: { ...FIX[kind] }, opts: defaultOpts(), markets, steps: [0, 1, 2].map(() => ({ availability: 1, bids: {} })), sel: 0 };
  }
  function freshState() {
    const s = { kind: 'plant', ex: null, k: { storage: blankScenario('storage'), plant: blankScenario('plant') }, code: defaultCode() };
    loadExample(s, 'plant-ramping');
    return s;
  }
  function loadExample(s, id) {
    const ex = EXAMPLES.find(e => e.id === id);
    if (!ex) return false;
    s.kind = ex.kind;
    s.k[ex.kind] = scenarioFromExample(ex);
    s.ex = id;
    return true;
  }
  function normalize(s) {
    const base = freshState();
    if (!s || typeof s !== 'object' || !s.k) return base;
    s.kind = s.kind === 'storage' ? 'storage' : 'plant';
    for (const kind of ['storage', 'plant']) {
      const sc = s.k[kind] = { ...blankScenario(kind), ...(s.k[kind] || {}) };
      sc.unit = { ...FIX[kind], ...(sc.unit || {}) };
      sc.opts = { ...defaultOpts(), ...(sc.opts || {}) };
      sc.markets = (Array.isArray(sc.markets) ? sc.markets : []).slice(0, 8).map((m, i) => ({ id: m.id || uid(), name: String(m.name ?? 'Market'), product: PRODUCTS.includes(m.product) ? m.product : 'energy', slot: Number.isInteger(m.slot) ? m.slot % 8 : i % 8 }));
      sc.steps = (Array.isArray(sc.steps) && sc.steps.length ? sc.steps : [{}]).slice(0, 48).map(st => ({ availability: num(st.availability, 1), bids: st.bids && typeof st.bids === 'object' ? st.bids : {} }));
      sc.sel = Math.min(Math.max(0, sc.sel | 0), sc.steps.length - 1);
    }
    if (!EXAMPLES.some(e => e.id === s.ex)) s.ex = null;
    const dc = defaultCode(), c = s.code && typeof s.code === 'object' ? s.code : {};
    s.code = { open: c.open !== false, tab: c.tab === 'mine' ? 'mine' : 'assume', name: String(c.name ?? ''), asserts: { ...dc.asserts, ...(c.asserts || {}) } };
    return s;
  }
  const b64enc = str => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64dec = str => decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
  function loadInitial() {
    const q = new URLSearchParams(location.search).get('example');
    if (q) { const s = freshState(); if (loadExample(s, q)) return s; }
    if (location.hash.startsWith('#s=')) {
      try { const s = normalize(JSON.parse(b64dec(location.hash.slice(3)))); history.replaceState(null, '', location.pathname + location.search); return s; }
      catch (e) { /* fall through */ }
    }
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* storage unavailable */ }
    return freshState();
  }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };

  let state = loadInitial();
  let sim = [];
  const cur = () => state.k[state.kind];
  const example = () => { const ex = EXAMPLES.find(e => e.id === state.ex); return ex && ex.kind === state.kind ? ex : null; };
  const hourLabel = t => { const m = Math.round(t * num(cur().opts.freq_h, 1) * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  function simulate() {
    const sc = cur();
    return M.simulate({ kind: state.kind, unit: sc.unit, opts: sc.opts, markets: sc.markets, steps: sc.steps });
  }
  function evalChecks() {
    const ex = example();
    if (!ex || !ex.checks) return [];
    return ex.checks.map(([h, stage, key, expected, label, tol]) => {
      const r = sim[h];
      const got = r ? M.checkValue(r, stage, key) : NaN;
      return { h, stage, key, expected, label, got, ok: Number.isFinite(got) && Math.abs(got - expected) <= (tol ?? 1e-6) };
    });
  }

  // ------------------------------------------------------------------ chart
  function svgDefs(pre) {
    let d = '<defs>';
    for (let i = 0; i < 8; i++) {
      d += `<pattern id="${pre}h${i}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" style="fill:var(--surface)"/><rect width="2.6" height="6" style="fill:var(--s${i + 1})"/></pattern>`;
    }
    d += `<pattern id="${pre}lock" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="1" height="5" style="fill:var(--locked);fill-opacity:.75"/></pattern>`;
    d += `<pattern id="${pre}xh" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" style="fill:var(--surface)"/><path d="M0 0L7 7M7 0L0 7" style="stroke:var(--xh);stroke-width:1"/></pattern>`;
    return d + '</defs>';
  }
  const SVG_STYLE = `<style>
    .ax{font:11px var(--f-mono);fill:var(--muted)} .ax-t{font:600 11px var(--f-body);fill:var(--ink-2);letter-spacing:.06em;text-transform:uppercase}
    .grid{stroke:var(--line-2);stroke-width:1}
    .seg-lbl{font:600 10.5px var(--f-body);fill:var(--ink)} .free-lbl{font:600 10.5px var(--f-mono);fill:var(--free-line)}
    .seg-lbl,.free-lbl{paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
    .det{font:11px var(--f-mono);fill:var(--ink-2)} .det.strong{font-weight:600;fill:var(--ink)} .det.bad{fill:var(--bad)}
    .tick-ln{stroke:var(--muted);stroke-width:1}
    .col-lbl{font:500 12px var(--f-mono);fill:var(--ink-2)} .col-lbl.sel{fill:var(--accent-ink);font-weight:600}
    .val{font:600 11px var(--f-mono);fill:var(--ink)} .val.bad{fill:var(--bad)} .val.ok{fill:var(--good)}
    .fan{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 3;fill:none}
    .brk{stroke:var(--accent);stroke-width:2.5;fill:none} .hit{fill:transparent;cursor:pointer}
    .hl-veil{fill:var(--surface);fill-opacity:.7} .hl-band{fill:var(--accent);fill-opacity:.24;stroke:var(--accent);stroke-width:2.5}
    .hl-win{fill:var(--accent);fill-opacity:.12;stroke:var(--accent);stroke-width:1.5;stroke-dasharray:5 3}
    .hl-mark{stroke:var(--accent);stroke-width:3;stroke-linecap:round} .hl-frame{fill:none;stroke:var(--accent);stroke-width:2}
    .hl-fan{stroke:var(--accent);stroke-width:2;fill:none} .hl-tag{fill:var(--accent)} .hl-tag-t{font:600 11px var(--f-mono);fill:var(--accent-ink)}
  </style>`;
  function niceTicks(min, max, count = 5) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  const tipAttr = t => (t ? ` data-tip="${esc(t)}"` : '');
  const fits = (text, w) => text.length * 5.9 <= w - 4;
  function splitSeg(a, b) {
    if (a >= 0 && b >= 0) return [{ a, b, grow: b > a }];
    if (a <= 0 && b <= 0) return [{ a, b, grow: b < a }];
    return [{ a, b: 0, grow: false }, { a: 0, b, grow: true }];
  }

  function drawCol(r, x, w, Y, pre, showLabels) {
    const c = r.ctx, o = r.o, sto = c.kind === 'storage', u = c.u;
    const out = [];
    const clip = v => Math.min(c.yMax, Math.max(c.yMin, v));
    const R = (a, b, style, tip) => {
      a = clip(a); b = clip(b);
      const yTop = Y(Math.max(a, b)), h = Y(Math.min(a, b)) - yTop;
      if (!(h > 0.4)) return;
      out.push(`<rect x="${x}" y="${yTop.toFixed(2)}" width="${w}" height="${h.toFixed(2)}" style="${style}"${tipAttr(tip)}/>`);
    };
    const label = (a, b, text, cls = 'seg-lbl', alt) => {
      if (!showLabels) return;
      a = clip(a); b = clip(b);
      const yTop = Y(Math.max(a, b)), h = Y(Math.min(a, b)) - yTop;
      if (h < 15) return;
      const t = fits(text, w) ? text : alt && fits(alt, w) ? alt : null;
      if (t) out.push(`<text x="${x + w / 2}" y="${(yTop + h / 2 + 3.8).toFixed(2)}" class="${cls}" text-anchor="middle" pointer-events="none">${esc(t)}</text>`);
    };
    const hatch = slot => `fill:url(#${pre}h${slot});stroke:var(--s${slot + 1});stroke-width:1`;
    const freeStyle = 'fill:var(--free);stroke:var(--free-line);stroke-width:1;stroke-dasharray:3 3';
    const xh = `fill:url(#${pre}xh)`;
    const E = o.energy;

    R(c.yMin, c.yMax, 'fill:var(--surface)');
    if (sto) {
      R(c.socDis, u.max_power_discharge, xh, `SOC ${fmt(c.soc, 3)}: cannot discharge more than ${fmt(c.socDis)} MW`);
      R(u.max_power_charge, c.socCh, xh, `SOC ${fmt(c.soc, 3)}: cannot charge more than ${fmt(-c.socCh)} MW`);
      R(c.U, Math.min(u.max_power_discharge, c.socDis), xh, `Out of reach from previous_power ${fmt(c.prev)} MW: ramp limits discharge to ${fmt(c.U)} MW`);
      R(Math.max(u.max_power_charge, c.socCh), c.L, xh, `Out of reach from previous_power ${fmt(c.prev)} MW: ramp limits charge to ${fmt(c.L)} MW`);
    } else {
      R(c.avail, u.max_power, xh, `Not available: availability ${fmt(c.availability)} × max_power = ${fmt(c.avail)} MW`);
      const why = c.U <= EPS && c.op < 0 && c.op > -u.min_down_time ? `min_down_time: off for ${-c.op} h, must stay off` : `ramp_up from previous_power ${fmt(c.prev)} MW`;
      R(c.U, c.avail, xh, `Out of reach this hour (${why}): up to ${fmt(c.U)} MW`);
    }
    for (const e of o.E) {
      const col = `var(--s${e.m.slot + 1})`;
      for (const p of splitSeg(e.from, e.to)) {
        if (p.grow) {
          R(p.a, p.b, `fill:${col};fill-opacity:.42;stroke:${col};stroke-width:1`, `${e.m.name}: energy ${e.v > 0 ? '+' : ''}${fmt(e.v)} MW`);
          // keep the label in the locked part so it does not collide with the free ↓ label
          const hi = !sto && E > EPS ? Math.min(Math.max(p.a, p.b), c.L) : Math.max(p.a, p.b);
          label(Math.min(p.a, p.b), hi, `${e.m.name} ${fmt(e.v)}`, 'seg-lbl', e.m.name);
        } else {
          R(p.a, p.b, `fill:var(--surface);stroke:${col};stroke-width:1.3;stroke-dasharray:4 3`, `${e.m.name}: ${fmt(e.v)} MW (reduces earlier energy)`);
          label(p.a, p.b, fmt(e.v));
        }
      }
    }
    if (!sto && E > EPS && c.L > EPS) R(0, Math.min(c.L, E), `fill:url(#${pre}lock)`, `Locked: cannot go below ${fmt(c.L)} MW (${c.L <= u.min_power + EPS ? 'min_power' : 'ramp_down from ' + fmt(c.prev)})`);

    // reserves around the energy point
    const negLow = sto ? E + o.capacity_neg : E - o.capacity_neg;
    let cur0 = E;
    for (const rr of o.RD) {
      const v = sto ? rr.v : -rr.v;
      R(cur0 + v, cur0, hatch(rr.m.slot), `${rr.m.name}: capacity_neg ${fmt(rr.v)} MW`);
      label(cur0 + v, cur0, `${rr.m.name} ${fmt(Math.abs(rr.v))}`, 'seg-lbl', fmt(Math.abs(rr.v)));
      cur0 += v;
    }
    cur0 = E;
    for (const rr of o.RU) {
      R(cur0, cur0 + rr.v, hatch(rr.m.slot), `${rr.m.name}: capacity_pos ${fmt(rr.v)} MW`);
      label(cur0, cur0 + rr.v, `${rr.m.name} ${fmt(rr.v)}`, 'seg-lbl', fmt(rr.v));
      cur0 += rr.v;
    }
    // free headroom (physical): between committed bands and the reachable range
    const top = E + o.capacity_pos;
    if (sto || E > EPS) {
      if (c.U - top > EPS) { R(top, c.U, freeStyle, `Free ↑ ${fmt(c.U - top)} MW within ramp, SOC and power limits`); label(top, c.U, `▲ ${fmt(c.U - top)}`, 'free-lbl'); }
      if (negLow - c.L > EPS) { R(c.L, negLow, freeStyle, `Free ↓ ${fmt(negLow - c.L)} MW within ramp${sto ? ', SOC' : ''} and min limits`); label(c.L, negLow, `▼ ${fmt(negLow - c.L)}`, 'free-lbl'); }
    } else if (c.U - c.L > EPS) {
      R(c.L, c.U, freeStyle, `Not running yet: can be dispatched between ${fmt(c.L)} and ${fmt(c.U)} MW`);
      label(c.L, c.U, `free ${fmt(c.U - c.L)}`, 'free-lbl', fmt(c.U - c.L));
    }

    if (!sto && u.min_power > EPS) out.push(`<line x1="${x}" x2="${x + w}" y1="${Y(u.min_power)}" y2="${Y(u.min_power)}" style="stroke:var(--ink-2);stroke-dasharray:4 3"/>`);
    if (sto) out.push(`<line x1="${x}" x2="${x + w}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-2)"/>`);
    out.push(`<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(clip(E))}" y2="${Y(clip(E))}" style="stroke:var(--ink);stroke-width:2.5"${tipAttr(`outputs["energy"] = ${fmt(E)} MW`)}/>`);
    const execDiff = Math.abs(r.exec - E) > 1e-6;
    if (execDiff) out.push(`<line x1="${x - 4}" x2="${x + w + 4}" y1="${Y(clip(r.exec))}" y2="${Y(clip(r.exec))}" style="stroke:var(--bad);stroke-width:2.5;stroke-dasharray:5 3"${tipAttr(`execute_current_dispatch → ${fmt(r.exec)} MW (scheduled ${fmt(E)} MW)`)}/>`);
    out.push(`<rect x="${x}" y="${Y(c.yMax)}" width="${w}" height="${Y(c.yMin) - Y(c.yMax)}" style="fill:none;stroke:var(--frame);stroke-width:1"/>`);

    // ASSUME offer window for the next market (after this hour's orders), as a bracket
    const bx = x + w + 5;
    const bracket = (a, b, tip) => {
      if (Math.abs(b - a) < EPS && Math.abs(a - E) < EPS) return;
      const y1 = Y(clip(Math.max(a, b))), y2 = Y(clip(Math.min(a, b)));
      out.push(`<path class="brk" d="M${bx - 3} ${y1}H${bx}V${Math.max(y2, y1 + 1)}H${bx - 3}"${tipAttr(tip)}/>`);
      out.push(`<rect x="${bx - 5}" y="${y1 - 2}" width="10" height="${Math.max(y2 - y1, 1) + 4}" style="fill:transparent"${tipAttr(tip)}/>`);
    };
    if (sto) {
      const w2 = r.end;
      if (w2.rampDis > EPS) bracket(E + w2.disMin, E + w2.rampDis, `Next discharge offer: calculate_min_max_discharge → (${fmt(w2.disMin)}, ${fmt(w2.disMax)}), after ramp ${fmt(w2.rampDis)}`);
      if (w2.rampCh < -EPS) bracket(E + w2.rampCh, E + w2.chMin, `Next charge offer: calculate_min_max_charge → (${fmt(w2.chMin)}, ${fmt(w2.chMax)}), after ramp ${fmt(w2.rampCh)}`);
    } else {
      const w2 = r.end;
      if (w2.rampMax > EPS || Math.abs(w2.rampMin) > EPS) bracket(E + w2.rampMin, E + w2.rampMax, `Next energy offer: calculate_min_max_power → (${fmt(w2.min)}, ${fmt(w2.max)}), after calculate_ramp (${fmt(w2.rampMin)}, ${fmt(w2.rampMax)})`);
    }
    return out.join('');
  }

  function drawSocCol(u, socStart, socEnd, x, w, Y, pre, initial) {
    const out = [];
    const v = initial ? socStart : socEnd;
    out.push(`<rect x="${x}" y="${Y(1)}" width="${w}" height="${Y(0) - Y(1)}" style="fill:var(--surface)"/>`);
    out.push(`<rect x="${x}" y="${Y(Math.max(0, Math.min(1, v)))}" width="${w}" height="${Y(0) - Y(Math.max(0, Math.min(1, v)))}" style="fill:var(--soc)"${tipAttr(`${initial ? 'initial_soc' : 'soc at end of hour'}: ${fmt(v, 4)} (${fmt(v * u.capacity, 1)} MWh)`)}/>`);
    if (u.min_soc > EPS) out.push(`<rect x="${x}" y="${Y(u.min_soc)}" width="${w}" height="${Y(0) - Y(u.min_soc)}" style="fill:url(#${pre}lock)"${tipAttr(`below min_soc ${fmt(u.min_soc)}`)}/>`);
    if (u.max_soc < 1 - EPS) out.push(`<rect x="${x}" y="${Y(1)}" width="${w}" height="${Y(u.max_soc) - Y(1)}" style="fill:url(#${pre}lock)"${tipAttr(`above max_soc ${fmt(u.max_soc)}`)}/>`);
    out.push(`<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--ink);stroke-width:2.5"/>`);
    out.push(`<rect x="${x}" y="${Y(1)}" width="${w}" height="${Y(0) - Y(1)}" style="fill:none;stroke:var(--frame)"/>`);
    return out.join('');
  }

  function sideLabels(items, x, Y, minGap = 13) {
    const arr = items.filter(it => Number.isFinite(it.v)).map(it => ({ ...it, y0: Y(it.v), y: Y(it.v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < arr.length; i++) if (arr[i].y - arr[i - 1].y < minGap) arr[i].y = arr[i - 1].y + minGap;
    return arr.map(it => `<path d="M${x} ${it.y0}L${x + 5} ${it.y0}L${x + 9} ${it.y}" class="tick-ln" fill="none"/><text x="${x + 12}" y="${(it.y + 3.8).toFixed(2)}" class="det${it.cls ? ' ' + it.cls : ''}">${esc(it.text)}</text>`).join('');
  }
  function yAxis(Y, min, max, x0, x1, specials) {
    let g = '';
    for (const t of niceTicks(min, max, 5)) {
      g += `<line x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/>`;
      if (specials.some(v => Math.abs(Y(v.v) - Y(t)) < 11)) continue;
      g += `<text x="${x0 - 8}" y="${Y(t) + 3.5}" class="ax" text-anchor="end">${fmt(t)}</text>`;
    }
    for (const v of specials) g += `<text x="${x0 - 8}" y="${Y(v.v) + 3.5}" class="ax" text-anchor="end" style="fill:var(--ink-2)">${esc(v.text)}</text>`;
    return g;
  }

  function renderChart() {
    const sc = cur(), sto = state.kind === 'storage', n = sim.length;
    if (!n) return;
    const many = n > 10;
    const colW = many ? 34 : 54, gap = many ? 40 : 96, left = 104, right = many ? 60 : 120, top = 36;
    const Hp = sto ? 260 : 320, Hs = sto ? 150 : 0, between = sto ? 56 : 0, bottom = 40;
    const cols = n + 1;
    const W = left + cols * colW + (cols - 1) * gap + right;
    const H = top + Hp + between + Hs + bottom;
    const c0 = sim[0].ctx, u = c0.u;
    const pMin = c0.yMin, pMax = c0.yMax > pMin ? c0.yMax : pMin + 1;
    const Yp = v => top + (pMax - v) / (pMax - pMin) * Hp;
    const colX = i => left + i * (colW + gap);
    const topS = top + Hp + between, Ys = v => topS + (1 - v) * Hs;
    const pre = 'c-';
    const x0 = left - 14, x1 = W - right + 30;
    let g = SVG_STYLE + svgDefs(pre) + `<rect x="0" y="0" width="${W}" height="${H}" style="fill:var(--surface)"/>`;
    const sel = sc.sel;
    g += `<rect x="${colX(sel + 1) - 12}" y="${top - 28}" width="${colW + 24 + (many ? 0 : 6)}" height="${H - top + 26}" rx="6" style="fill:var(--sel-bg)"/>`;
    g += `<text x="${x0 - 8}" y="${top - 18}" class="ax-t" text-anchor="end">MW</text>`;
    g += yAxis(Yp, pMin, pMax, x0, x1, sto ? [{ v: 0, text: '0' }] : [{ v: u.min_power, text: `min ${fmt(u.min_power)}` }, { v: u.max_power, text: `max ${fmt(u.max_power)}` }].filter(s => s.v > 0));

    // previous-power column
    {
      const x = colX(0), p0 = num(sc.opts.initial_previous_power);
      g += `<rect x="${x}" y="${Yp(pMax)}" width="${colW}" height="${Hp}" style="fill:var(--surface-2);stroke:var(--line)"/>`;
      if (Math.abs(p0) > EPS) g += `<rect x="${x}" y="${Yp(Math.max(p0, 0))}" width="${colW}" height="${Math.abs(Yp(p0) - Yp(0))}" style="fill:var(--soc)"${tipAttr(`previous_power before the first hour: ${fmt(p0)} MW`)}/>`;
      if (sto) g += `<line x1="${x}" x2="${x + colW}" y1="${Yp(0)}" y2="${Yp(0)}" style="stroke:var(--ink-2)"/>`;
      g += `<line x1="${x - 2}" x2="${x + colW + 2}" y1="${Yp(p0)}" y2="${Yp(p0)}" style="stroke:var(--ink);stroke-width:2.5"/>`;
      g += `<text x="${x + colW / 2}" y="${top - 10}" class="val" text-anchor="middle">${fmt(p0)}</text>`;
      g += `<text x="${x + colW / 2}" y="${H - 14}" class="col-lbl" text-anchor="middle">before</text>`;
    }
    const checks = evalChecks();
    sim.forEach((r, i) => {
      const x = colX(i + 1), selected = i === sel;
      const xp = colX(i) + colW, yp = Yp(r.prev);
      g += `<path class="fan" d="M${xp} ${yp}L${x} ${Yp(Math.min(r.ctx.U, pMax))}M${xp} ${yp}L${x} ${Yp(Math.max(Math.min(r.ctx.L, r.ctx.U), pMin))}"/>`;
      g += `<g data-step="${i}" style="cursor:pointer"><rect class="hit" x="${x - 12}" y="${top - 28}" width="${colW + 24}" height="${H - top + 26}"/>`;
      g += drawCol(r, x, colW, Yp, pre, !many);
      g += `</g>`;
      const hc = checks.filter(z => z.h === i);
      const bad = hc.some(z => !z.ok), execDiff = Math.abs(r.exec - r.o.energy) > 1e-6;
      const mark = bad ? '✗ ' : hc.length ? '✓ ' : '';
      g += `<text x="${x + colW / 2}" y="${top - 10}" class="val${bad || execDiff ? ' bad' : hc.length ? ' ok' : ''}" text-anchor="middle"${execDiff ? tipAttr(`execute_current_dispatch → ${fmt(r.exec)} MW`) : ''}>${mark}${fmt(r.o.energy)}${execDiff && !many ? ` → ${fmt(r.exec)}` : ''}</text>`;
      if (selected && !many) {
        const c = r.ctx, items = [{ v: r.o.energy, text: `energy ${fmt(r.o.energy)}`, cls: 'strong' }];
        if (sto) {
          items.push({ v: c.U, text: `reach ↑ ${fmt(c.U)}` }, { v: c.L, text: `reach ↓ ${fmt(c.L)}` });
        } else {
          if (c.U < u.max_power - EPS) items.push({ v: c.U, text: `${c.U < c.avail - EPS ? 'ramp ↑' : 'available'} ${fmt(c.U)}` });
          if (r.o.energy > EPS && c.L > u.min_power + EPS) items.push({ v: c.L, text: `ramp ↓ ${fmt(c.L)}` });
        }
        if (Math.abs(r.exec - r.o.energy) > 1e-6) items.push({ v: r.exec, text: `executed ${fmt(r.exec)}`, cls: 'bad' });
        g += sideLabels(items, x + colW + 12, Yp);
      }
      const lbl = hourLabel(i);
      if (selected) { const tw = lbl.length * 8 + 14; g += `<rect x="${x + colW / 2 - tw / 2}" y="${H - 29}" width="${tw}" height="21" rx="10.5" style="fill:var(--accent)"/>`; }
      g += `<text x="${x + colW / 2}" y="${H - 14}" class="col-lbl${selected ? ' sel' : ''}" text-anchor="middle" data-step="${i}" style="cursor:pointer${many && !selected ? ';font-size:10px' : ''}">${lbl}</text>`;
    });

    if (sto) {
      g += `<text x="${x0 - 8}" y="${topS - 16}" class="ax-t" text-anchor="end">SOC</text>`;
      g += yAxis(Ys, 0, 1, x0, x1, []);
      g += drawSocCol(u, sim[0].soc, null, colX(0), colW, Ys, pre, true);
      g += `<text x="${colX(0) + colW / 2}" y="${topS - 8}" class="val" text-anchor="middle">${fmt(sim[0].soc, 3)}</text>`;
      sim.forEach((r, i) => {
        const x = colX(i + 1);
        g += `<path class="fan" d="M${colX(i) + colW} ${Ys(r.soc)}L${x} ${Ys(r.socEnd)}"/>`;
        g += `<g data-step="${i}" style="cursor:pointer">${drawSocCol(u, r.soc, r.socEnd, x, colW, Ys, pre, false)}</g>`;
        g += `<text x="${x + colW / 2}" y="${topS - 8}" class="val" text-anchor="middle">${fmt(r.socEnd, 3)}</text>`;
      });
    }
    const svg = $('#chart');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = g;
    geo = { Yp, Ys, colX, colW, top, Hp, topS, Hs, W, H, pMin, pMax, sto };
    drawHighlight();
    $('#chartSub').textContent = sto
      ? `Storage · ${fmt(u.max_power_charge)} to ${fmt(u.max_power_discharge)} MW · ${fmt(u.capacity)} MWh`
      : `PowerPlant · ${fmt(u.min_power)}–${fmt(u.max_power)} MW · ramp ${u.ramp_up == null ? 'None' : fmt(u.ramp_up)} / ${u.ramp_down == null ? 'None' : fmt(u.ramp_down)}`;
  }

  function renderLegend() {
    const sc = cur(), sto = state.kind === 'storage';
    const items = sc.markets.map(m => `<span><i class="sw" style="--c:var(--s${m.slot + 1})" data-prod="${m.product === 'energy' ? '' : 'up'}"></i>${esc(m.name)}</span>`);
    items.push('<span class="sep" aria-hidden="true"></span>');
    items.push('<span><i class="lg-key lg-free"></i>Free headroom</span>');
    items.push('<span><i class="lg-key lg-xh"></i>Out of reach</span>');
    if (!sto) items.push('<span><i class="lg-key lg-lock"></i>Locked (min_power / ramp_down)</span>');
    items.push('<span><i class="lg-key" style="background:none;border-left:2.5px solid var(--accent);border-top:2px solid var(--accent);border-bottom:2px solid var(--accent);width:6px"></i>Next offer window</span>');
    items.push('<span><i class="lg-key" style="height:0;border-top:2.5px dashed var(--bad)"></i>After execute_current_dispatch</span>');
    $('#legend').innerHTML = items.join('');
  }

  // ------------------------------------------------------------------ side panels
  function renderUnit() {
    const sc = cur(), sto = state.kind === 'storage';
    $$('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind)));
    $('#unitClass').textContent = sto ? 'Storage' : 'PowerPlant';
    $('#unitFields').innerHTML = UNIT_FIELDS[state.kind].map(f =>
      `<label>${f}<input type="number" step="any" id="u-${f}" data-u="${f}" value="${esc(sc.unit[f] ?? '')}"${RAMP_FIELDS.has(f) ? ' placeholder="None"' : ''}></label>`).join('');
    $('#scFields').innerHTML =
      (sto ? '' : `<label>previous_power before the first hour<input type="number" step="any" id="o-prev" data-o="initial_previous_power" value="${esc(sc.opts.initial_previous_power)}"></label>`) +
      `<label>index.freq (hours)<input type="number" step="any" min="0.01" id="o-freq" data-o="freq_h" value="${esc(sc.opts.freq_h)}"></label>` +
      (sto ? `<label>previous_power before the first hour<input type="number" step="any" id="o-prev" data-o="initial_previous_power" value="${esc(sc.opts.initial_previous_power)}"></label>` : '');
    $('#optExecute').checked = !!sc.opts.execute;
  }
  function renderExampleSelect() {
    const groups = {};
    EXAMPLES.forEach(e => { (groups[e.file] = groups[e.file] || []).push(e); });
    let h = `<option value="">${state.ex ? 'Load another example…' : 'Load example…'}</option>`;
    for (const [file, list] of Object.entries(groups)) {
      h += `<optgroup label="${esc(file)}">` + list.map(e => `<option value="${e.id}">${esc(e.test)}</option>`).join('') + '</optgroup>';
    }
    h += '<optgroup label="Start fresh"><option value="__blank">Empty scenario</option></optgroup>';
    $('#example').innerHTML = h;
  }
  function renderBanner(checks) {
    const ex = example();
    $('#exBanner').hidden = !ex;
    if (!ex) return;
    const a = $('#exSrc');
    a.textContent = `${ex.file} · ${ex.test}`;
    a.href = REPO + ex.file;
    $('#exTitle').textContent = ex.title;
    $('#exNote').textContent = ex.note;
    const ok = checks.filter(c => c.ok).length;
    const firstBad = checks.find(c => !c.ok);
    $('#exSummary').innerHTML = checks.length
      ? `<button type="button" class="pill ${ok === checks.length ? 'ok' : 'bad'}" data-act="sel" data-step="${firstBad ? firstBad.h : cur().sel}">${ok === checks.length ? '✓' : '✗'} ${ok} of ${checks.length} test asserts match</button>`
      : '';
  }

  // ------------------------------------------------------------------ grid
  function renderGrid() {
    const sc = cur(), S = sc.steps, Mk = sc.markets, sto = state.kind === 'storage';
    const scl = i => (i === sc.sel ? 'sel' : '');
    let h = '<thead><tr><th class="corner" scope="col">Market · product_type</th>';
    S.forEach((s, i) => { h += `<th scope="col" class="stepcol ${scl(i)}"><button type="button" class="steptab" data-act="sel" data-step="${i}">${hourLabel(i)}</button></th>`; });
    h += '</tr></thead><tbody>';
    if (!sto) {
      h += `<tr class="availrow"><th scope="row">availability</th>` + S.map((s, i) => `<td class="${scl(i)}"><input type="number" step="any" min="0" max="1" id="av-${i}" data-avail="${i}" value="${esc(s.availability)}" aria-label="availability ${hourLabel(i)}"></td>`).join('') + '</tr>';
    }
    if (!Mk.length) h += `<tr><td colspan="${S.length + 1}" class="sub">Add a market to place orders.</td></tr>`;
    Mk.forEach((m, j) => {
      h += `<tr><th scope="row"><div class="mrowhead" data-mid="${m.id}">
        <button type="button" class="swatch" data-act="color" style="--c:var(--s${m.slot + 1})" aria-label="Change colour"></button>
        <input class="mname" id="mn-${m.id}" data-mf="name" value="${esc(m.name)}" aria-label="Market name" autocomplete="off">
        <span class="mbtns"><button type="button" data-act="mup" ${j === 0 ? 'disabled' : ''} aria-label="Clear earlier" title="Clear earlier">↑</button><button type="button" data-act="mdown" ${j === Mk.length - 1 ? 'disabled' : ''} aria-label="Clear later" title="Clear later">↓</button><button type="button" data-act="mdel" aria-label="Remove market" title="Remove">×</button></span>
        <select id="mp-${m.id}" data-mf="product" aria-label="product_type">${PRODUCTS.map(p => `<option${p === m.product ? ' selected' : ''}>${p}</option>`).join('')}</select>
      </div></th>`;
      S.forEach((s, i) => {
        const b = s.bids[m.id] || { v: '', on: true };
        const empty = String(b.v).trim() === '';
        h += `<td class="${scl(i)}"><div class="cell${empty ? ' empty' : ''}" data-step="${i}" data-mid="${m.id}">
          <input class="offer" id="o-${i}-${m.id}" value="${esc(b.v)}" placeholder="–" aria-label="${esc(m.name)} ${hourLabel(i)} accepted volume" autocomplete="off" spellcheck="false">
          <button type="button" class="oc" data-act="oc" data-o="${b.on === false ? 'rej' : 'acc'}" title="Accepted or not">${b.on === false ? '✗' : '✓'}</button>
          <span class="hint"></span></div></td>`;
      });
      h += '</tr>';
    });
    h += '</tbody><tfoot>';
    const rows = sto
      ? [['energy', 'energy'], ['res', 'capacity_pos / _neg'], ['soc', 'soc start → end'], ['exec', 'executed energy'], ['next', 'next offer (dis / ch)']]
      : [['energy', 'energy'], ['res', 'capacity_pos / _neg'], ['op', 'op_time'], ['exec', 'executed energy'], ['next', 'next offer (calculate_ramp)']];
    rows.forEach(([k, l]) => { h += `<tr><th scope="row">${l}</th>` + S.map((s, i) => `<td class="${scl(i)}" data-foot="${k}" data-step="${i}"></td>`).join('') + '</tr>'; });
    h += '</tfoot>';
    $('#bidGrid').innerHTML = h;
    $('#hours').value = S.length;
    $('#addMarket').disabled = Mk.length >= 8;
  }
  function updateGridComputed() {
    const sto = state.kind === 'storage';
    sim.forEach((r, i) => {
      r.stages.forEach(st => {
        const cell = $(`.cell[data-step="${i}"][data-mid="${st.m.id}"]`);
        if (!cell) return;
        const hint = cell.querySelector('.hint');
        let text = '', cls = '';
        if (st.invalid) { text = 'not a number'; cls = 'bad'; }
        else if (st.offer != null && st.auto) text = `= ${fmt(st.offer)}`;
        else if (st.offer == null) {
          const w = st.win;
          text = sto ? (st.m.product === 'energy' ? `↑${fmt(w.rampDis, 1)} ↓${fmt(w.rampCh, 1)}` : st.m.product === 'capacity_pos' ? `≤ ${fmt(w.rampDis, 1)}` : `≥ ${fmt(w.rampCh, 1)}`)
            : (st.m.product === 'capacity_neg' ? `≤ ${fmt(Math.max(r.prev - w.rampMin, 0), 1)}` : `${fmt(w.rampMin, 1)}…${fmt(w.rampMax, 1)}`);
        }
        hint.textContent = text;
        hint.className = 'hint' + (cls ? ' ' + cls : '');
        cell.classList.toggle('empty', st.offer == null);
      });
      const set = (k, html, flag) => { const td = $(`td[data-foot="${k}"][data-step="${i}"]`); if (td) { td.innerHTML = html; td.classList.toggle('flag', !!flag); } };
      set('energy', fmt(r.o.energy));
      set('res', `${fmt(r.o.capacity_pos)} / ${fmt(r.o.capacity_neg)}`);
      if (sto) set('soc', `${fmt(r.soc, 3)} → ${fmt(r.socEnd, 3)}`); else set('op', String(r.op));
      const diff = Math.abs(r.exec - r.o.energy) > 1e-6;
      set('exec', diff ? `⚠ ${fmt(r.exec)}` : fmt(r.exec), diff);
      set('next', sto ? `${fmt(r.end.rampDis)} / ${fmt(r.end.rampCh)}` : `(${fmt(r.end.rampMin)}, ${fmt(r.end.rampMax)})`);
    });
  }

  // ------------------------------------------------------------------ hour detail
  const stageName = (stage, sc) => stage === 's' ? 'before the first market' : stage === 'e' ? 'after all orders' : stage === 'h' ? 'for the hour' : `before ${sc.markets[stage] ? sc.markets[stage].name : 'market ' + (stage + 1)}`;
  function renderHour(checks) {
    const sc = cur(), r = sim[sc.sel], sto = state.kind === 'storage';
    if (!r) return;
    $('#hourTitle').textContent = `Hour ${hourLabel(sc.sel)}`;
    $('#hourSub').textContent = sto
      ? `previous_power ${fmt(r.prev)} MW · soc ${fmt(r.soc, 4)}`
      : `previous_power ${fmt(r.prev)} MW · op_time ${r.op} · availability ${fmt(r.ctx.availability)}`;
    const hc = checks.filter(c => c.h === sc.sel);
    $('#hourChecks').innerHTML = hc.length ? `<div class="checks">${hc.map(c => `<div class="check ${c.ok ? 'ok' : 'bad'}"><span class="ic">${c.ok ? '✓' : '✗'}</span><span><code>${esc(c.label)}</code> <span class="where">${esc(stageName(c.stage, sc))}</span></span><span class="got">${c.ok ? fmt(c.got, 4) : `got ${fmt(c.got, 4)}, expected ${fmt(c.expected, 4)}`}</span></div>`).join('')}</div>` : '';

    const winText = w => sto
      ? `dis (${fmt(w.disMin)}, ${fmt(w.disMax)}) → ramp ${fmt(w.rampDis)}<span class="win">ch (${fmt(w.chMin)}, ${fmt(w.chMax)}) → ramp ${fmt(w.rampCh)}</span>`
      : `(${fmt(w.min)}, ${fmt(w.max)})<span class="win">calculate_ramp → (${fmt(w.rampMin)}, ${fmt(w.rampMax)})</span>`;
    let t = `<thead><tr><th>#</th><th>Market</th><th>product_type</th><th>${sto ? 'ASSUME window before this market' : 'calculate_min_max_power before this market'}</th><th>Order</th><th>Accepted</th></tr></thead><tbody>`;
    r.stages.forEach((st, j) => {
      const has = st.offer != null;
      t += `<tr class="${has ? '' : 'muted'}"><td>${j + 1}</td><td><span class="mcell"><span class="sw" style="--c:var(--s${st.m.slot + 1})" data-prod="${st.m.product === 'energy' ? '' : 'up'}"></span>${esc(st.m.name)}</span></td><td>${st.m.product}</td>
        <td style="text-align:left">${winText(st.win)}</td><td>${has ? fmt(st.offer) + (st.auto ? ' <span class="sub">(max)</span>' : '') : '–'}</td>
        <td>${has ? (st.on ? `<span class="pill ok">✓ ${fmt(st.acc)}</span>` : '<span class="pill bad">✗ not accepted</span>') : '–'}</td></tr>`;
    });
    t += `</tbody><tfoot><tr><td></td><td colspan="2" style="text-align:left;font-family:var(--f-body)">After all orders</td><td style="text-align:left">${winText(r.end)}</td><td colspan="2" style="text-align:left;font-family:var(--f-body)">energy ${fmt(r.o.energy)} · pos ${fmt(r.o.capacity_pos)} · neg ${fmt(r.o.capacity_neg)}${Math.abs(r.exec - r.o.energy) > 1e-6 ? ` · <span class="note-bad">executed ${fmt(r.exec)}</span>` : ''}</td></tr></tfoot>`;
    $('#ledger').innerHTML = t;
    renderExplain(r);
  }
  const li = (code, words) => `<li><span class="c">${code}</span>${words ? `<span class="w">${words}</span>` : ''}</li>`;
  function renderExplain(r) {
    const o = r.o, E = fmt(o.energy), P = fmt(o.capacity_pos), N = paren(o.capacity_neg), w = r.end, u = r.ctx.u;
    let h = '';
    if (r.ctx.kind === 'storage') {
      const d = w.dis, c = w.ch;
      h += `<div class="fnblock"><h4>calculate_min_max_discharge</h4><ol>`;
      h += li(`<b>max</b> = max_power_discharge − (energy + capacity_pos) = ${fmt(u.max_power_discharge)} − (${E} + ${P}) = <b>${fmt(d.raw_max)}</b>`, 'Full discharge power minus what is sold and what is kept for positive reserve.');
      h += li(`<b>min</b> = min_power_discharge − (energy + capacity_neg) = ${fmt(u.min_power_discharge)} − (${E} + ${N}) = ${fmt(d.raw_min)} → clip(min=0)`,
        d.raw_min > 0 ? `When discharging, it must discharge at least this much more, so the negative reserve can be delivered without switching to charging.` : 'No minimum.');
      if (d.maxZeroed) h += li('max < min → max = 0', 'Nothing can be offered.');
      h += li(`SOC limit = (soc − min_soc) · capacity · η_dis / Δt = ${fmt(d.socLim)}`, d.socBinding ? '<b>Binding.</b>' : 'Not binding.');
      h += `</ol><span class="ret">→ (${fmt(d.min)}, ${fmt(d.max)}) · ramp ${fmt(w.rampDis)}</span></div>`;
      h += `<div class="fnblock"><h4>calculate_min_max_charge</h4><ol>`;
      h += li(`<b>min</b> = min_power_charge − (energy + capacity_pos) = ${fmt(u.min_power_charge)} − (${E} + ${P}) = ${fmt(c.raw_min)} → clip(max=0)`,
        c.raw_min < 0 ? 'When charging, it must charge at least this much, so the positive reserve can be delivered without switching to discharging.' : 'No minimum.');
      h += li(`<b>max</b> = max_power_charge − (energy + capacity_neg) = ${fmt(u.max_power_charge)} − (${E} + ${N}) = <b>${fmt(c.raw_max)}</b>`, 'Full charge power, shifted by what is sold and what is kept for negative reserve.');
      if (c.maxZeroed) h += li('max > min → max = 0', 'Nothing can be offered.');
      h += li(`SOC limit = (soc − max_soc) · capacity / η_ch / Δt = ${fmt(c.socLim)}`, c.socBinding ? '<b>Binding.</b>' : 'Not binding.');
      h += `</ol><span class="ret">→ (${fmt(c.min)}, ${fmt(c.max)}) · ramp ${fmt(w.rampCh)}</span></div>`;
      h += `<div class="fnblock"><h4>calculate_ramp_discharge / _charge</h4><ol>`;
      h += li(`previous_power = ${fmt(r.prev)}, current_power = ${E}`, '');
      h += li(`discharge cap = max(previous_power⁺ + ramp_up_discharge − current_power, 0) = ${u.ramp_up_discharge == null ? 'None' : fmt(Math.max(Math.max(r.prev, 0) + u.ramp_up_discharge - o.energy, 0))}`, '');
      h += li(`charge cap = min(previous_power⁻ + ramp_up_charge − current_power, 0) = ${u.ramp_up_charge == null ? 'None' : fmt(Math.min(Math.min(r.prev, 0) + u.ramp_up_charge - o.energy, 0))}`, 'Both are also clipped by SOC. An offer below the window minimum becomes 0.');
      h += `</ol><span class="ret">→ ${fmt(w.rampDis)} / ${fmt(w.rampCh)}</span></div>`;
    } else {
      const pw = w.pw;
      h += `<div class="fnblock"><h4>calculate_min_max_power</h4><ol>`;
      h += li(`<b>max</b> = availability · max_power − capacity_pos − energy = ${fmt(r.ctx.availability)} · ${fmt(u.max_power)} − ${P} − ${E} = ${fmt(pw.raw_max)} → clip(min=0)`, 'Available capacity minus positive reserve and what is already sold.');
      h += li(`<b>min</b> = min_power + capacity_neg − energy = ${fmt(u.min_power)} + ${N} − ${E} = ${fmt(pw.raw_min)} → clip(min=0)`, 'Run requirement plus negative reserve, minus what is already sold.');
      if (pw.infeasible) h += li('max < min → (0, 0)', 'The minimum cannot be met within the available capacity.');
      h += `</ol><span class="ret">→ (${fmt(w.min)}, ${fmt(w.max)})</span></div>`;
      h += `<div class="fnblock"><h4>calculate_ramp(op_time=${r.op}, previous_power=${fmt(r.prev)}, power, current_power=${E})</h4><ol>`;
      if (u.ramp_up == null && u.ramp_down == null) h += li('ramp_up and ramp_down are None', 'The power is returned unchanged.');
      else {
        if (r.op < 0 && r.op > -u.min_down_time) h += li(`op_time ${r.op} > −min_down_time (${-u.min_down_time})`, 'Off for too short a time: any power above 0 becomes 0.');
        if (r.op > 0 && r.op < u.min_operating_time) h += li(`0 < op_time ${r.op} < min_operating_time (${u.min_operating_time})`, 'Running for too short a time: an offer of 0 becomes min_power.');
        if (u.ramp_up != null) h += li(`upper = min(power, previous_power + ramp_up − current_power, max_power − current_power) → ${fmt(r.prev)} + ${fmt(u.ramp_up)} − ${E} = ${fmt(r.prev + u.ramp_up - o.energy)}`, '');
        if (u.ramp_down != null) h += li(`lower = max(power, previous_power − ramp_down − current_power, min_power − current_power) → ${fmt(r.prev)} − ${fmt(u.ramp_down)} − ${E} = ${fmt(r.prev - u.ramp_down - o.energy)}`, '');
      }
      h += `</ol><span class="ret">power=min → ${fmt(w.rampMin)} · power=max → ${fmt(w.rampMax)}</span></div>`;
    }
    $('#explain').innerHTML = h;
  }

  // ------------------------------------------------------------------ test code
  // The loaded example's ASSUME test (fetched at the pinned commit), or a pytest test written from the scenario
  // (testcode.js). Hovering a line shades in the chart what that line reads or changes.
  const SRC_KEY = `unit-headroom-tracker:src:${UP.PINNED}:`;
  const sources = {};  // file -> text | Promise | Error
  let geo = null, codeLines = [], codeText = '', hoverIdx = null;
  const defaultTestName = () => `test_${(example() ? example().id : `${state.kind}_scenario`).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
  const testName = () => {
    const n = String(state.code.name).trim().replace(/[^A-Za-z0-9_]/g, '_');
    return n ? (n.startsWith('test_') ? n : `test_${n}`) : defaultTestName();
  };
  function loadSource(file) {
    if (sources[file] !== undefined) return;
    try { const t = localStorage.getItem(SRC_KEY + file); if (t) { sources[file] = t; return; } } catch (e) { /* storage unavailable */ }
    sources[file] = fetch(UP.rawUrl(UP.PINNED, file))
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(t => { sources[file] = t; try { localStorage.setItem(SRC_KEY + file, t); } catch (e) { /* ignore */ } })
      .catch(err => { sources[file] = err instanceof Error ? err : new Error(String(err)); })
      .then(renderCode);
  }
  const hlCode = text => TC.tokens(text).map(([c, t]) => (c ? `<span class="t-${c}">${esc(t)}</span>` : esc(t))).join('') || ' ';
  function codeRows(lines, firstNo, results) {
    return lines.map((l, i) => {
      const lk = l.links.length > 0;
      let mk = '';
      if (results && l.first && l.checks.length) {
        const bad = l.checks.filter(k => !results[k].ok);
        const tip = bad.length ? bad.map(k => `got ${fmt(results[k].got, 4)}, expected ${fmt(results[k].expected, 4)}`).join('; ') : 'matches the tool';
        mk = `<span class="mk ${bad.length ? 'bad' : 'ok'}" title="${esc(tip)}">${bad.length ? '✗' : '✓'}</span>`;
      }
      const focus = lk && l.first !== false && (i === 0 || lines[i - 1].links !== l.links) ? ' tabindex="0"' : '';
      return `<div class="ln${lk ? ' lk' : ''}" data-ln="${i}"${focus}><span class="no">${firstNo + i}</span><span class="mkc">${mk}</span><code>${hlCode(l.text)}</code></div>`;
    }).join('');
  }
  function renderAssumeCode() {
    const ex = example();
    codeLines = []; codeText = '';
    $('#codeFoot').textContent = '';
    if (!ex) {
      $('#codeHead').innerHTML = '<p class="code-msg">No ASSUME test is loaded. Pick one from the example menu, or open <button type="button" class="linkbtn" data-codetab="mine">Your test</button> to write one from this scenario.</p>';
      $('#code').innerHTML = '';
      return;
    }
    const name = ex.test.split(' · ')[0], s = sources[ex.file], gh = UP.blobUrl(UP.PINNED, ex.file);
    if (s === undefined || s instanceof Promise) {
      loadSource(ex.file);
      $('#codeHead').innerHTML = `<p class="code-msg">Loading <code>${esc(ex.file)}</code> at <code>${UP.PINNED.slice(0, 7)}</code>…</p>`;
      $('#code').innerHTML = '';
      return;
    }
    const fn = s instanceof Error ? null : UP.pyFunctions(s)[name];
    if (!fn) {
      $('#codeHead').innerHTML = `<p class="code-msg">${s instanceof Error ? `Could not load the test from GitHub (${esc(s.message)}).` : `<code>${esc(name)}</code> is not in the file.`} <a href="${esc(gh)}" target="_blank" rel="noopener">Open ${esc(ex.file)} on GitHub</a></p>`;
      $('#code').innerHTML = '';
      return;
    }
    const sc = cur(), results = evalChecks();
    const fnLines = fn.code.split('\n'), defAt = Math.max(0, fnLines.findIndex(l => /^\s*(async\s+)?def\s/.test(l)));
    const fixtures = ((fnLines[defAt].match(/\(([^)]*)\)/) || [])[1] || '').split(',').map(x => x.trim()).filter(x => x && x !== 'mock_market_config');
    codeLines = TC.annotate(fn.code, { hour0: ex.hour0, hours: sc.steps.length, markets: sc.markets.map(m => [m.name, m.product]), checks: ex.checks, kind: state.kind });
    codeText = fn.code + '\n';
    const ok = results.filter(r => r.ok).length;
    $('#codeHead').innerHTML = `<a href="${esc(UP.blobUrl(UP.PINNED, ex.file, fn.line))}" target="_blank" rel="noopener">${esc(ex.file)}#L${fn.line}</a>`
      + (fixtures.length ? `<span>Fixture <code>${esc(fixtures.join(', '))}</code>, with the Unit panel's values.</span>` : '')
      + (results.length ? `<span class="pill ${ok === results.length ? 'ok' : 'bad'}">${ok === results.length ? '✓' : '✗'} ${ok} of ${results.length} asserts</span>` : '')
      + '<button type="button" class="btn small" data-act="code-copy">Copy</button>';
    $('#code').innerHTML = codeRows(codeLines, fn.line - defAt, results);
    $('#codeFoot').textContent = 'Hover a marked line to see it in the chart. Click it to open that hour. ✓ and ✗ compare each assert with what the tool computes now.';
  }
  function renderMyCode() {
    const sc = cur(), c = state.code, sto = state.kind === 'storage';
    const g = TC.generate({ unit: sc.unit, opts: sc.opts, markets: sc.markets, steps: sc.steps }, state.kind, sim, { name: testName(), ...c.asserts, exec: c.asserts.exec && !!sc.opts.execute });
    codeLines = g.lines.map(l => ({ ...l, first: true, checks: [] }));
    codeText = g.code;
    const name = testName(), input = $('#testName');
    if (document.activeElement !== input) input.value = c.name;
    input.placeholder = defaultTestName();
    $$('[data-ta]').forEach(cb => { cb.checked = !!c.asserts[cb.dataset.ta]; });
    $$('#codeOpts [data-only]').forEach(l => { l.hidden = l.dataset.only !== state.kind; });
    const ex = $('#taExec'), on = !!sc.opts.execute;
    ex.classList.toggle('off', !on);
    ex.querySelector('input').disabled = !on;
    if (!on) ex.querySelector('input').checked = false;
    ex.title = on ? '' : 'Turn on “Run execute_current_dispatch after each hour” to assert it';
    $('#codeHead').innerHTML = `<p class="code-msg">A pytest test for this ${sto ? 'storage' : 'power plant'} and its orders. Save it as <code>tests/${esc(name)}.py</code> in ASSUME and run <code>pytest tests/${esc(name)}.py</code>.</p>`;
    $('#code').innerHTML = codeRows(codeLines, 1, null);
    $('#codeFoot').textContent = `Orders are written to unit.outputs, as in the ASSUME capacity tests. The asserts hold what this tool computes with the ASSUME ${UP.PINNED.slice(0, 7)} formulas.`;
  }
  function renderCode() {
    const c = state.code;
    document.body.classList.toggle('with-code', c.open);
    $('#codeCol').hidden = !c.open;
    $('#codeToggle').setAttribute('aria-pressed', String(c.open));
    if (!c.open) { setHover(null); return; }
    $$('#codeCol .seg [data-codetab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.codetab === c.tab)));
    $('#codeOpts').hidden = c.tab !== 'mine';
    if (c.tab === 'mine') renderMyCode(); else renderAssumeCode();
    const i = hoverIdx;
    hoverIdx = null;
    setHover(i != null && codeLines[i] && codeLines[i].links.length ? i : null);
  }
  // lines of one statement share their links, so hovering any of them lights up the whole statement
  function setHover(i) {
    if (i === hoverIdx) return;
    hoverIdx = i;
    $$('#code .ln.hot').forEach(el => el.classList.remove('hot'));
    if (i != null) {
      const key = JSON.stringify(codeLines[i].links);
      let a = i, b = i;
      while (a > 0 && JSON.stringify(codeLines[a - 1].links) === key) a--;
      while (b < codeLines.length - 1 && JSON.stringify(codeLines[b + 1].links) === key) b++;
      for (let k = a; k <= b; k++) { const el = $(`#code .ln[data-ln="${k}"]`); if (el) el.classList.add('hot'); }
    }
    drawHighlight();
  }
  const firstHour = links => { const l = links.find(x => Number.isInteger(x.h) && x.h >= 0 && x.h < sim.length); return l ? l.h : null; };

  const PY_NAME = { disMin: 'min_power_discharge', disMax: 'max_power_discharge', chMin: 'min_power_charge', chMax: 'max_power_charge', min: 'min_power', max: 'max_power',
    rampMin: 'min_ramp', rampMax: 'max_ramp', rampDis: 'max_ramp_discharge', rampCh: 'max_ramp_charge', inflex: 'inflexible bid', flex: 'flexible bid' };
  // window w and energy already sold E at a stage of hour r ('s' before the first market, n before market n, 'e' after all)
  function stageAt(r, stage) {
    if (stage === 's') return { w: r.start, E: 0 };
    if (stage === 'e' || stage === 'h' || !r.stages[stage]) return { w: r.end, E: r.o.energy };
    return { w: r.stages[stage].win, E: r.stages[stage - 1] ? r.stages[stage - 1].after.energy : 0 };
  }
  // [low, high, value] in absolute MW: the return values are relative to the energy already sold
  function valueSpan(w, E, key) {
    const v = w[key];
    if (key === 'disMin' || key === 'disMax') return [E + w.disMin, E + w.disMax, E + v];
    if (key === 'chMin' || key === 'chMax') return [E + w.chMax, E + w.chMin, E + v];
    if (key === 'min' || key === 'max') return [E + w.min, E + w.max, E + v];
    if (key === 'rampMin' || key === 'rampMax') return [E + w.rampMin, E + w.rampMax, E + v];
    if (key === 'rampDis') return [E, E + v, E + v];
    if (key === 'rampCh') return [E + v, E, E + v];
    if (key === 'inflex') return [E, E + w.inflex, E + w.inflex];
    if (key === 'flex') return [E + w.inflex, E + w.inflex + w.flex, E + w.inflex + w.flex];
    return null;
  }
  function drawHighlight() {
    const svg = $('#chart'), old = svg.querySelector('#hl');
    if (old) old.remove();
    const links = hoverIdx != null && codeLines[hoverIdx] ? codeLines[hoverIdx].links : null;
    if (!links || !links.length || !geo || !sim.length) return;
    const g = geo, n = sim.length, u = sim[0].ctx.u, sto = g.sto, out = [], tags = {}, cols = new Set();
    const clip = v => Math.min(g.pMax, Math.max(g.pMin, v));
    const inH = h => Number.isInteger(h) && h >= 0 && h < n;
    const box = (col, a, b, cls) => {
      const y1 = g.Yp(clip(Math.max(a, b))), y2 = g.Yp(clip(Math.min(a, b)));
      out.push(`<rect x="${g.colX(col) - 3}" y="${(y1 - 1.5).toFixed(1)}" width="${g.colW + 6}" height="${(Math.max(y2 - y1, 0) + 3).toFixed(1)}" class="${cls}"/>`);
    };
    // short: the label used when many columns are tagged at once
    const tag = (col, y, text, short) => (tags[col] = tags[col] || []).push({ y, text, short: short || text });
    const mark = (col, v, text, short) => {
      const y = g.Yp(clip(v));
      out.push(`<line x1="${g.colX(col) - 7}" x2="${g.colX(col) + g.colW + 7}" y1="${y}" y2="${y}" class="hl-mark"/>`);
      if (text) tag(col, y, text, short);
    };
    const frame = (col, y1, y2) => out.push(`<rect x="${g.colX(col) - 5}" y="${y1 - 5}" width="${g.colW + 10}" height="${y2 - y1 + 10}" rx="4" class="hl-frame"/>`);
    const socAt = h => (h < n ? sim[h].soc : sim[n - 1].socEnd);
    const socMark = (col, v, text) => {
      frame(col, g.Ys(1), g.Ys(0));
      const y = g.Ys(Math.max(0, Math.min(1, v)));
      out.push(`<line x1="${g.colX(col) - 7}" x2="${g.colX(col) + g.colW + 7}" y1="${y}" y2="${y}" class="hl-mark"/>`);
      tag(col, y, text);
    };
    const hline = (v, text) => {
      const y = g.Yp(clip(v));
      out.push(`<line x1="${g.colX(1) - 8}" x2="${g.colX(n) + g.colW + 8}" y1="${y}" y2="${y}" class="hl-mark"/>`);
      tag(n, y, text);
    };
    for (const l of links) {
      if (l.what === 'unit') {
        const a = l.attr, v = M.num(u[a]);
        if (/^(max|min)_power/.test(a)) hline(v, `${a} = ${fmt(v)}`);
        else if (/^ramp_/.test(a)) {
          sim.forEach((r, i) => {
            const xp = g.colX(i) + g.colW, x = g.colX(i + 1), yp = g.Yp(clip(r.prev));
            out.push(`<path class="hl-fan" d="M${xp} ${yp}L${x} ${g.Yp(clip(r.ctx.U))}M${xp} ${yp}L${x} ${g.Yp(clip(Math.min(r.ctx.L, r.ctx.U)))}"/>`);
          });
          tag(1, g.Yp(clip(sim[0].ctx.U)), `${a} = ${u[a] == null ? 'None' : fmt(u[a])}`);
        } else if (a === 'availability' && !sto) {
          sim.forEach((r, i) => { if (r.ctx.avail < u.max_power - EPS) box(i + 1, r.ctx.avail, u.max_power, 'hl-band'); tag(i + 1, g.Yp(clip(r.ctx.avail)), `availability ${fmt(r.ctx.availability)}`, fmt(r.ctx.availability)); });
        } else if (a === 'min_operating_time' || a === 'min_down_time') {
          sim.forEach((r, i) => tag(i + 1, g.top + 6, `op_time ${r.op}`, String(r.op)));
        } else if (sto && a === 'initial_soc') { cols.add(0); socMark(0, socAt(0), `initial_soc = ${fmt(socAt(0), 3)}`); }
        else if (sto && (a === 'min_soc' || a === 'max_soc')) {
          const y = g.Ys(v);
          out.push(`<line x1="${g.colX(0) - 8}" x2="${g.colX(n) + g.colW + 8}" y1="${y}" y2="${y}" class="hl-mark"/>`);
          tag(n, y, `${a} = ${fmt(v)}`);
        } else if (sto) for (let c = 0; c <= n; c++) frame(c, g.Ys(1), g.Ys(0));
        continue;
      }
      if (l.what === 'soc') {
        if (!sto || !(l.h >= 0 && l.h <= n)) continue;
        cols.add(l.h);
        socMark(l.h, socAt(l.h), `soc = ${fmt(socAt(l.h), 4)}`);
        continue;
      }
      if (!inH(l.h)) continue;
      const r = sim[l.h], col = l.h + 1;
      cols.add(col);
      if (l.what === 'hour') frame(col, g.top, g.top + g.Hp);
      else if (l.what === 'band') {
        const E = r.o.energy, o = r.o;
        const span = l.product === 'energy' ? [0, E, E] : l.product === 'capacity_pos' ? [E, E + o.capacity_pos, E + o.capacity_pos]
          : sto ? [E + o.capacity_neg, E, E + o.capacity_neg] : [E - o.capacity_neg, E, E - o.capacity_neg];
        const val = l.product === 'energy' ? E : o[l.product];
        if (Math.abs(span[1] - span[0]) > EPS) { box(col, span[0], span[1], 'hl-band'); tag(col, g.Yp(clip(span[2])), `${l.product} = ${fmt(val)}`, fmt(val)); }
        else mark(col, E, `${l.product} = ${fmt(val)}`, fmt(val));
      } else if (l.what === 'value') {
        const { w, E } = stageAt(r, l.stage), sp = valueSpan(w, E, l.key);
        if (!sp) continue;
        if (Math.abs(sp[1] - sp[0]) > EPS) box(col, sp[0], sp[1], 'hl-win');
        mark(col, sp[2], `${PY_NAME[l.key]} = ${fmt(w[l.key])}`, fmt(w[l.key]));
      } else if (l.what === 'exec') mark(col, r.exec, `execute_current_dispatch → ${fmt(r.exec)}`, `→ ${fmt(r.exec)}`);
      else if (l.what === 'prev') { cols.add(l.h); mark(l.h, r.prev, `previous_power = ${fmt(r.prev)}`); }
      else if (l.what === 'op') {
        const k = Math.max(u.min_operating_time || 0, u.min_down_time || 0, 1);
        for (let c = Math.max(0, l.h - k + 1); c <= l.h; c++) { cols.add(c); frame(c, g.top, g.top + g.Hp); }
        tag(col, g.top + 6, `op_time = ${r.op}`);
      } else if (l.what === 'offer') {
        const st = r.stages[l.n];
        if (!st || st.offer == null) continue;
        const Eb = l.n > 0 ? r.stages[l.n - 1].after.energy : 0, v = st.offer;
        const sp = st.m.product === 'capacity_neg' ? (sto ? [Eb + v, Eb] : [Eb - v, Eb]) : [Eb, Eb + v];
        box(col, sp[0], sp[1], 'hl-win');
        tag(col, g.Yp(clip(Math.max(sp[0], sp[1]))), `${st.m.name} bid = ${fmt(v)}`);
      }
    }
    if (cols.size) for (let c = 0; c <= n; c++) if (!cols.has(c)) out.unshift(`<rect x="${g.colX(c) - 12}" y="${g.top - 30}" width="${g.colW + 24}" height="${g.H - g.top + 30}" class="hl-veil"/>`);
    // tags right of their column (left when they would leave the chart), pushed apart so they do not overlap
    const compact = Object.keys(tags).length > 2 || n > 10;
    for (const [col, list] of Object.entries(tags)) {
      list.sort((a, b) => a.y - b.y);
      let last = -Infinity;
      for (const t of list) {
        const text = compact ? t.short : t.text;
        const y = Math.max(t.y, last + 20), w = text.length * 6.7 + 12;
        let x = g.colX(+col) + g.colW + 10;
        if (x + w > g.W - 2) x = Math.max(2, g.colX(+col) - 10 - w);
        last = y;
        out.push(`<rect x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" width="${w.toFixed(1)}" height="18" rx="9" class="hl-tag"/><text x="${(x + 6).toFixed(1)}" y="${(y + 3.8).toFixed(1)}" class="hl-tag-t">${esc(text)}</text>`);
      }
    }
    svg.insertAdjacentHTML('beforeend', `<g id="hl" pointer-events="none">${out.join('')}</g>`);
    // bring the first highlighted column into view when the chart scrolls sideways
    const first = Math.min(...(cols.size ? cols : [0])), box0 = svg.parentElement, x0 = g.colX(first) - 24;
    if (box0.scrollWidth > box0.clientWidth && (x0 < box0.scrollLeft || x0 + g.colW + 220 > box0.scrollLeft + box0.clientWidth)) box0.scrollTo({ left: Math.max(0, x0 - 40), behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ render loop
  function update() {
    sim = simulate();
    const checks = evalChecks();
    renderBanner(checks);
    renderChart();
    updateGridComputed();
    renderHour(checks);
    renderCode();
    save();
  }
  function renderAll() {
    renderExampleSelect();
    renderUnit();
    renderLegend();
    renderGrid();
    update();
  }
  function select(i) {
    const sc = cur();
    sc.sel = Math.min(Math.max(0, i), sc.steps.length - 1);
    $$('#bidGrid .sel').forEach(el => el.classList.remove('sel'));
    $$('#bidGrid tr').forEach(tr => {
      Array.from(tr.children).slice(1, 1 + sc.steps.length).forEach((td, j) => td.classList.toggle('sel', j === sc.sel));
    });
    update();
  }
  function setHours(n) {
    const sc = cur();
    n = Math.min(48, Math.max(1, Math.round(n) || 1));
    while (sc.steps.length < n) sc.steps.push({ availability: 1, bids: {} });
    sc.steps.length = n;
    sc.sel = Math.min(sc.sel, n - 1);
    renderGrid();
    update();
  }

  // ------------------------------------------------------------------ events
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
      ta.remove();
      toast(ok ? okMsg : 'Copy failed. Your browser blocked clipboard access.');
    }
  }
  document.addEventListener('click', e => {
    const kb = e.target.closest('[data-kind]');
    if (kb) { state.kind = kb.dataset.kind; renderAll(); return; }
    const tab = e.target.closest('[data-codetab]');
    if (tab) { state.code.tab = tab.dataset.codetab; hoverIdx = null; renderCode(); save(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act, sc = cur();
      if (a === 'sel') { select(+act.dataset.step); return; }
      if (a === 'code-toggle') { state.code.open = !state.code.open; renderCode(); save(); return; }
      if (a === 'code-copy') { copyText(codeText, state.code.tab === 'mine' ? 'Test copied. Paste it into a file under tests/ in ASSUME.' : 'Test code copied'); return; }
      if (a === 'code-dl') { download(`${testName()}.py`, new Blob([codeText], { type: 'text/x-python' })); return; }
      if (a === 'up-show') { $('#upBanner').hidden = false; $('#upBanner').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (a === 'up-hide') { $('#upBanner').hidden = true; try { localStorage.setItem(UP_HIDE_KEY, upstream.latest.sha); } catch (err) { /* ignore */ } return; }
      if (a === 'hours-') { setHours(sc.steps.length - 1); return; }
      if (a === 'hours+') { setHours(sc.steps.length + 1); return; }
      if (a === 'addmarket') {
        if (sc.markets.length >= 8) return;
        const used = new Set(sc.markets.map(m => m.slot));
        let slot = 0; while (used.has(slot)) slot++;
        sc.markets.push({ id: uid(), name: `Market ${sc.markets.length + 1}`, product: 'energy', slot });
        renderLegend(); renderGrid(); update();
        return;
      }
      const mh = act.closest('.mrowhead');
      if (mh) {
        const idx = sc.markets.findIndex(m => m.id === mh.dataset.mid), m = sc.markets[idx];
        if (a === 'color') { const used = new Set(sc.markets.map(x => x.slot)); for (let k = 1; k <= 8; k++) { const s = (m.slot + k) % 8; if (!used.has(s) || k === 8) { m.slot = s; break; } } }
        if (a === 'mup' && idx > 0) sc.markets.splice(idx - 1, 0, sc.markets.splice(idx, 1)[0]);
        if (a === 'mdown' && idx < sc.markets.length - 1) sc.markets.splice(idx + 1, 0, sc.markets.splice(idx, 1)[0]);
        if (a === 'mdel') { sc.markets.splice(idx, 1); sc.steps.forEach(st => delete st.bids[m.id]); }
        renderLegend(); renderGrid(); update();
        return;
      }
      if (a === 'oc') {
        const cell = act.closest('.cell'), i = +cell.dataset.step, mid = cell.dataset.mid;
        const st = sc.steps[i];
        const b = st.bids[mid] || (st.bids[mid] = { v: '', on: true });
        b.on = b.on === false;
        act.dataset.o = b.on ? 'acc' : 'rej';
        act.textContent = b.on ? '✓' : '✗';
        if (String(b.v).trim() === '' && b.on) delete st.bids[mid];
        update();
        return;
      }
    }
    const stepEl = e.target.closest('svg [data-step]');
    if (stepEl) { select(+stepEl.dataset.step); return; }
    const exp = e.target.closest('[data-export]');
    if (exp) { $('#exportMenu').open = false; doExport(exp.dataset.export); return; }
    if (e.target.closest('#copyLink')) {
      const ex = example();
      copyText(location.origin + location.pathname + '#s=' + b64enc(JSON.stringify(state)), ex ? 'Link copied. It opens this scenario.' : 'Link copied. It contains this scenario.');
      return;
    }
    const menu = $('#exportMenu');
    if (menu.open && !e.target.closest('#exportMenu')) menu.open = false;
  });
  document.addEventListener('input', e => {
    const t = e.target, sc = cur();
    if (t.id === 'testName') { state.code.name = t.value; renderCode(); save(); return; }
    if (t.dataset.u) { sc.unit[t.dataset.u] = t.value; update(); return; }
    if (t.dataset.o) { sc.opts[t.dataset.o] = t.value; if (t.dataset.o === 'freq_h') { renderGrid(); } update(); return; }
    if (t.dataset.avail != null) { sc.steps[+t.dataset.avail].availability = t.value; update(); return; }
    if (t.id === 'hours') { if (t.value !== '') setHours(+t.value); return; }
    if (t.dataset.mf === 'name') { const m = sc.markets.find(x => x.id === t.closest('.mrowhead').dataset.mid); m.name = t.value; renderLegend(); update(); return; }
    if (t.classList.contains('offer')) {
      const cell = t.closest('.cell'), i = +cell.dataset.step, mid = cell.dataset.mid, st = sc.steps[i];
      const b = st.bids[mid] || (st.bids[mid] = { v: '', on: true });
      b.v = t.value;
      if (t.value.trim() === '' && b.on !== false) delete st.bids[mid];
      update();
    }
  });
  document.addEventListener('change', e => {
    const t = e.target, sc = cur();
    if (t.id === 'optExecute') { sc.opts.execute = t.checked; update(); return; }
    if (t.dataset.ta) { state.code.asserts[t.dataset.ta] = t.checked; renderCode(); save(); return; }
    if (t.dataset.mf === 'product') { const m = sc.markets.find(x => x.id === t.closest('.mrowhead').dataset.mid); m.product = t.value; renderLegend(); renderGrid(); update(); return; }
    if (t.id === 'example' && t.value) {
      if (t.value === '__blank') { state.k[state.kind] = blankScenario(state.kind); state.ex = null; renderAll(); toast('Started an empty scenario'); return; }
      loadExample(state, t.value);
      renderAll();
      toast(`Loaded ${example() ? example().test : 'example'}`);
      return;
    }
    if (t.id === 'importFile' && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => { try { state = normalize(JSON.parse(reader.result)); renderAll(); toast('Scenario imported'); } catch (err) { toast('That file is not a valid scenario JSON'); } };
      reader.readAsText(t.files[0]);
      t.value = ''; $('#exportMenu').open = false;
    }
  });

  // tooltip
  const tip = $('#tip');
  $('#chart').addEventListener('mousemove', e => {
    const tg = e.target.closest('[data-tip]');
    if (!tg) { tip.hidden = true; return; }
    tip.textContent = tg.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  });
  $('#chart').addEventListener('mouseleave', () => { tip.hidden = true; });

  // code lines: hover or focus shows the line in the chart, click (or Enter) opens its hour
  const codeEl = $('#code');
  const lineOf = el => { const ln = el.closest && el.closest('.ln.lk'); return ln ? +ln.dataset.ln : null; };
  codeEl.addEventListener('mouseover', e => setHover(lineOf(e.target)));
  codeEl.addEventListener('mouseleave', () => setHover(null));
  codeEl.addEventListener('focusin', e => setHover(lineOf(e.target)));
  codeEl.addEventListener('focusout', e => { if (!codeEl.contains(e.relatedTarget)) setHover(null); });
  const openLine = i => { if (i == null) return; const h = firstHour(codeLines[i].links); if (h != null && h !== cur().sel) select(h); };
  codeEl.addEventListener('click', e => openLine(lineOf(e.target)));
  codeEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const i = lineOf(e.target); if (i != null) { e.preventDefault(); openLine(i); } } });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // export
  function resolvedSvg(svgEl) {
    const cs = getComputedStyle(document.documentElement);
    let s = svgEl.outerHTML;
    for (let k = 0; k < 3; k++) s = s.replace(/var\((--[\w-]+)\)/g, (_, name) => cs.getPropertyValue(name).trim() || '#000');
    if (!s.includes('xmlns=')) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return s;
  }
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fileBase = () => (example() ? example().id : `assume-${state.kind}`);
  function doExport(kind) {
    const svgEl = $('#chart');
    if (kind === 'json') download(`${fileBase()}.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    if (kind === 'copyjson') copyText(JSON.stringify(state, null, 2), 'Scenario JSON copied');
    if (kind === 'svg') download(`${fileBase()}.svg`, new Blob([resolvedSvg(svgEl)], { type: 'image/svg+xml' }));
    if (kind === 'png') {
      const w = +svgEl.getAttribute('width'), h = +svgEl.getAttribute('height'), scale = 2;
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
        const ctx = cv.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, w, h);
        cv.toBlob(b => b && download(`${fileBase()}.png`, b), 'image/png');
      };
      img.onerror = () => toast('PNG export failed. Try SVG instead.');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(resolvedSvg(svgEl));
    }
  }

  // ------------------------------------------------------------------ ASSUME main
  // Compares the pinned ASSUME commit with main (assets/upstream.js) and lists changed tests and ported functions.
  const UP_CACHE_KEY = 'unit-headroom-tracker:upstream:v1', UP_HIDE_KEY = 'unit-headroom-tracker:upstream-hidden';
  const UP_TTL = 6 * 3600 * 1000;
  const UP_STATUS = { changed: 'changed', added: 'new', removed: 'removed' };
  let upstream = null;
  function renderUpstream(r) {
    upstream = r;
    const sh = sha => sha.slice(0, 7);
    const status = $('#upStatus');
    const n = r.tests.length + r.sources.length + r.missing.length;
    if (r.upToDate || !n) {
      status.innerHTML = r.upToDate ? `<span class="upok">✓ Same as ASSUME ${UP.BRANCH}.</span>`
        : `ASSUME ${UP.BRANCH} (<a href="${esc(r.latest.url)}" target="_blank" rel="noopener">${sh(r.latest.sha)}</a>) has newer commits, none affecting these formulas or tests.`;
      return;
    }
    status.innerHTML = `<button type="button" class="linkbtn upwarn" data-act="up-show">ASSUME ${UP.BRANCH} changed ${n} tracked function${n === 1 ? '' : 's'}</button>`;
    $('#upSub').innerHTML = `Since <code>${sh(r.pinned)}</code>, ASSUME <code>${UP.BRANCH}</code> (<a href="${esc(r.latest.url)}" target="_blank" rel="noopener">${sh(r.latest.sha)}</a>, ${esc((r.latest.date || '').slice(0, 10))}) changed the tests or functions below. `
      + `The examples and formulas here still follow <code>${sh(r.pinned)}</code> until they are ported. `
      + `<a href="https://github.com/${UP.REPO}/compare/${r.pinned}...${r.latest.sha}" target="_blank" rel="noopener">Full comparison</a>`;
    const row = i => {
      const href = i.status === 'removed' ? UP.blobUrl(r.pinned, i.file, i.oldLine) : UP.blobUrl(r.latest.sha, i.file, i.line);
      const ex = i.kind === 'test' && i.ported ? EXAMPLES.filter(e => e.file === i.file && e.test.split(' · ')[0] === i.name) : [];
      const tag = i.kind === 'test' ? (ex.length ? `<a href="?example=${ex[0].id}">example in the tool</a>` : 'no example yet') : i.kind === 'fixture' ? 'fixture' : '';
      return `<li><span class="uptag ${i.status === 'changed' ? 'warn' : i.status === 'added' ? 'ok' : 'bad'}">${UP_STATUS[i.status]}</span>`
        + `<a class="upfn" href="${esc(href)}" target="_blank" rel="noopener">${esc(i.name)}</a><span class="sub">${tag}</span></li>`;
    };
    const group = (title, items) => {
      if (!items.length) return '';
      const byFile = {};
      items.forEach(i => { (byFile[i.file] = byFile[i.file] || []).push(i); });
      return `<h3>${title}</h3>` + Object.entries(byFile).map(([f, list]) => `<p class="upfile">${esc(f)}</p><ul class="uplist">${list.map(row).join('')}</ul>`).join('');
    };
    $('#upList').innerHTML = (r.missing.length ? `<h3>Files no longer on ${UP.BRANCH}</h3><ul class="uplist">${r.missing.map(f => `<li><code>${esc(f)}</code></li>`).join('')}</ul>` : '')
      + group('Tests and fixtures', r.tests) + group('Functions ported in the formulas', r.sources);
    let hidden = null; try { hidden = localStorage.getItem(UP_HIDE_KEY); } catch (e) { /* ignore */ }
    $('#upBanner').hidden = hidden === r.latest.sha;
  }
  async function checkUpstream() {
    const status = $('#upStatus');
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(UP_CACHE_KEY)); } catch (e) { /* ignore */ }
    if (cached && cached.r && cached.r.pinned === UP.PINNED && Date.now() - cached.t < UP_TTL) { renderUpstream(cached.r); return; }
    status.textContent = `Checking ASSUME ${UP.BRANCH}…`;
    try {
      const r = UP.markPorted(await UP.check(), EXAMPLES);
      try { localStorage.setItem(UP_CACHE_KEY, JSON.stringify({ t: Date.now(), r })); } catch (e) { /* ignore */ }
      renderUpstream(r);
    } catch (e) {
      status.textContent = `Could not check ASSUME ${UP.BRANCH} for newer tests.`;
    }
  }

  renderAll();
  checkUpstream();
})();

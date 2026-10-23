/* Unit Headroom Tracker
 * Sequential market clearing for a single power unit: shows how much capacity (thermal) or
 * power/SOC (storage) is still available after each market's bids are accepted or rejected.
 * Plain browser JS, no build step, so it can be served directly from GitHub Pages. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const EPS = 1e-6;
  const STORE_KEY = 'unit-headroom-tracker:v1';
  const uid = () => Math.random().toString(36).slice(2, 9);
  const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const clamp0 = v => Math.max(0, v);
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const fmt = (v, dp = 2) => {
    if (v == null || !Number.isFinite(v)) return '–';
    const f = Math.pow(10, dp);
    let r = Math.round(v * f) / f;
    if (Object.is(r, -0)) r = 0;
    return r.toLocaleString('en-US', { maximumFractionDigits: dp });
  };
  const signed = v => (v > EPS ? '+' : '') + fmt(v);

  const PRODUCTS = {
    energy: { label: 'Energy', tag: 'E' },
    up: { label: 'Reserve ↑ (positive)', tag: 'R↑' },
    down: { label: 'Reserve ↓ (negative)', tag: 'R↓' },
    sym: { label: 'Reserve ↕ (symmetric)', tag: 'R↕' },
  };
  const OUTCOME = { acc: '✓ Won', part: '◐ Part', rej: '✗ Lost' };
  const NEXT_OUTCOME = { acc: 'rej', rej: 'part', part: 'acc' };

  const BASE_UNIT = {
    kind: 'thermal', name: 'Unit',
    pmax: 100, pmin: 25, ru: 30, rd: 30, p0: 60,
    pdis: 10, pch: 10, emax: 20, emin: 2, soc0: 10, etaC: 0.95, etaD: 0.95,
  };

  // ------------------------------------------------------------------ presets
  const mk = (name, product, slot, duration = 1) => ({ id: uid(), name, product, slot, duration });
  const bid = (offer, outcome = 'acc', accepted = '') => ({ offer: String(offer), outcome, accepted: String(accepted) });
  const mkSteps = (markets, rows, labels) => rows.map((row, i) => ({
    label: labels ? labels[i] : 't' + (i + 1),
    bids: Object.fromEntries(markets.map((m, j) => [m.id, row[j]]).filter(([, b]) => b)),
  }));

  function slidePreset(p0, pt) {
    const M = [mk('EOM', 'energy', 0), mk('CRM +', 'up', 2), mk('CRM −', 'down', 6)];
    return {
      unit: { ...BASE_UNIT, kind: 'thermal', name: 'Unit s', pmax: 100, pmin: 25, ru: 29, rd: 22, p0 },
      dt: 1, markets: M, steps: mkSteps(M, [[bid(pt), bid('max'), bid('max')]], ['t']), sel: 0,
    };
  }

  const PRESETS = {
    flexable: () => {
      const M = [mk('aFRR +', 'up', 2, 4), mk('aFRR −', 'down', 6, 4), mk('Day-ahead', 'energy', 0), mk('Redispatch', 'energy', 4)];
      return {
        unit: { ...BASE_UNIT, kind: 'thermal', name: 'Hard coal unit A', pmax: 500, pmin: 200, ru: 150, rd: 150, p0: 350 },
        dt: 1, markets: M, sel: 0,
        steps: mkSteps(M, [
          [bid(60), bid(50), bid('max'), bid(-40)],
          [bid(60, 'rej'), bid(50), bid('max', 'part', 300), bid(50)],
          [bid(100), bid(80), bid('max', 'rej'), null],
          [null, null, bid(200), null],
        ]),
      };
    },
    battery: () => {
      const M = [mk('FCR', 'sym', 2, 0.5), mk('Day-ahead', 'energy', 0), mk('Intraday', 'energy', 1)];
      return {
        unit: { ...BASE_UNIT, kind: 'storage', name: 'Battery 10 MW / 20 MWh', pdis: 10, pch: 10, emax: 20, emin: 2, soc0: 10, etaC: 0.95, etaD: 0.95 },
        dt: 1, markets: M, sel: 0,
        steps: mkSteps(M, [
          [bid(5), bid('max'), bid(-3)],
          [bid(5, 'rej'), bid('-max'), bid(2)],
          [bid(5), bid('max'), bid('max', 'part', 1)],
          [bid('max'), bid(-4), null],
        ]),
      };
    },
    slide1: () => slidePreset(63, 73),
    slide2: () => slidePreset(38, 55),
    slide3: () => slidePreset(77, 88),
    blankThermal: () => {
      const M = [mk('Day-ahead', 'energy', 0)];
      return { unit: { ...BASE_UNIT, kind: 'thermal', name: 'Thermal unit' }, dt: 1, markets: M, sel: 0, steps: mkSteps(M, [[], [], []]) };
    },
    blankStorage: () => {
      const M = [mk('Day-ahead', 'energy', 0)];
      return { unit: { ...BASE_UNIT, kind: 'storage', name: 'Storage unit' }, dt: 1, markets: M, sel: 0, steps: mkSteps(M, [[], [], []]) };
    },
  };

  // ------------------------------------------------------------------ state
  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    s.unit = { ...BASE_UNIT, ...(s.unit || {}) };
    if (s.unit.kind !== 'storage') s.unit.kind = 'thermal';
    s.dt = num(s.dt, 1) > 0 ? num(s.dt, 1) : 1;
    s.markets = Array.isArray(s.markets) ? s.markets.slice(0, 8) : [];
    s.markets.forEach(m => {
      m.id = m.id || uid();
      m.name = String(m.name ?? 'Market');
      if (!PRODUCTS[m.product]) m.product = 'energy';
      m.duration = num(m.duration, 1);
      m.slot = ((m.slot | 0) % 8 + 8) % 8;
    });
    s.steps = Array.isArray(s.steps) && s.steps.length ? s.steps : [{ label: 't1', bids: {} }];
    s.steps.forEach((st, i) => { st.label = String(st.label ?? 't' + (i + 1)); st.bids = st.bids && typeof st.bids === 'object' ? st.bids : {}; });
    s.sel = Math.min(Math.max(0, s.sel | 0), s.steps.length - 1);
    return s;
  }

  const b64enc = str => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64dec = str => decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
  // Share links store ids implicitly by position to keep URLs short.
  function packState(s) {
    return { u: s.unit, dt: s.dt, sel: s.sel, m: s.markets.map(m => [m.name, m.product, m.slot, m.duration]),
      s: s.steps.map(st => [st.label, s.markets.map(m => { const b = st.bids[m.id]; return b ? [b.offer, b.outcome, b.accepted] : 0; })]) };
  }
  function unpackState(p) {
    const markets = (p.m || []).map(([name, product, slot, duration]) => ({ id: uid(), name, product, slot, duration }));
    const steps = (p.s || []).map(([label, row]) => ({ label, bids: Object.fromEntries(markets.map((m, j) => [m.id, row[j] ? { offer: row[j][0], outcome: row[j][1], accepted: row[j][2] } : null]).filter(([, b]) => b)) }));
    return normalize({ unit: p.u, dt: p.dt, sel: p.sel, markets, steps });
  }

  function loadInitial() {
    const ex = new URLSearchParams(location.search).get('example');
    if (ex && Object.prototype.hasOwnProperty.call(PRESETS, ex)) return normalize(PRESETS[ex]());
    const h = location.hash;
    if (h.startsWith('#s=')) {
      try {
        const s = unpackState(JSON.parse(b64dec(h.slice(3))));
        history.replaceState(null, '', location.pathname + location.search);
        return s;
      } catch (e) { /* fall through */ }
    }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
    return normalize(PRESETS.flexable());
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  let state = loadInitial();
  let sim = [];

  // ------------------------------------------------------------------ unit model
  function unitCtx(u, prevP, soc, dt) {
    if (u.kind === 'thermal') {
      const pmax = clamp0(num(u.pmax)), pmin = Math.min(clamp0(num(u.pmin)), pmax), ru = clamp0(num(u.ru)), rd = clamp0(num(u.rd));
      const online = prevP > EPS;
      const U = online ? Math.min(pmax, prevP + ru) : Math.min(pmax, Math.max(pmin, ru));
      const L = online ? Math.max(pmin, prevP - rd) : pmin;
      const canOff = !online || prevP - rd <= pmin + EPS;
      return { kind: 'thermal', prevP, online, U, L, canOff, pmax, pmin, yMin: 0, yMax: pmax };
    }
    const pdis = clamp0(num(u.pdis)), pch = clamp0(num(u.pch)), emax = clamp0(num(u.emax));
    const emin = Math.min(clamp0(num(u.emin)), emax);
    const etaC = num(u.etaC, 1) > 0 ? num(u.etaC, 1) : 1, etaD = num(u.etaD, 1) > 0 ? num(u.etaD, 1) : 1;
    const maxDis = clamp0(Math.min(pdis, (soc - emin) * etaD / dt));
    const maxCh = clamp0(Math.min(pch, (emax - soc) / (etaC * dt)));
    return { kind: 'storage', soc, pdis, pch, emax, emin, etaC, etaD, dt, maxDis, maxCh, yMin: -pch, yMax: pdis };
  }
  const socEnd = (c, P) => c.soc - (P > 0 ? P * c.dt / c.etaD : P * c.dt * c.etaC);
  const emptySched = () => ({ P: 0, Rup: 0, Rdn: 0, Eup: 0, Edn: 0, E: [], RU: [], RD: [] });

  function feasible(c, s, ignoreEnergy, tol = EPS) {
    if (c.kind === 'thermal') {
      // P = 0 means "no energy scheduled yet": the band left for a later schedule must be non-empty.
      if (s.P > EPS) return s.P - s.Rdn >= c.L - tol && s.P + s.Rup <= c.U + tol;
      return c.L + s.Rdn <= c.U - s.Rup + tol;
    }
    if (s.P + s.Rup > c.pdis + tol || s.P - s.Rdn < -c.pch - tol) return false;
    if (ignoreEnergy) return true;
    const e = socEnd(c, s.P);
    return e - s.Eup >= c.emin - tol && e + s.Edn <= c.emax + tol;
  }
  function withInc(c, s, product, dir, x, d) {
    const t = { ...s };
    if (product === 'energy') t.P += dir * x;
    if (product === 'up' || product === 'sym') { t.Rup += x; if (c.kind === 'storage') t.Eup += x * d / c.etaD; }
    if (product === 'down' || product === 'sym') { t.Rdn += x; if (c.kind === 'storage') t.Edn += x * d * c.etaC; }
    return t;
  }
  // Largest increment that keeps the schedule feasible (constraints are monotone in the increment).
  function maxInc(c, s, product, dir, d, ignoreEnergy) {
    if (!feasible(c, s, ignoreEnergy)) return 0;
    // Search with a tighter tolerance and round down, so the result passes the normal check once committed.
    const f = x => feasible(c, withInc(c, s, product, dir, x, d), ignoreEnergy, 1e-9);
    let lo = 0, hi = c.kind === 'thermal' ? c.pmax * 2 + 1 : c.pdis + c.pch + 1;
    if (f(hi)) return hi;
    for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (f(mid)) lo = mid; else hi = mid; }
    return Math.floor(lo * 1e6 + 1e-3) / 1e6;
  }

  // Volume a market could still take, before it clears.
  function availability(c, s, m) {
    const d = num(m.duration, 1);
    if (m.product === 'energy') {
      if (c.kind === 'thermal') {
        const lo = c.L + s.Rdn, hi = c.U - s.Rup;
        return { up: clamp0(hi - s.P), down: s.P > EPS ? clamp0(s.P - lo) : 0, minBlock: s.P > EPS ? 0 : lo };
      }
      const up = maxInc(c, s, 'energy', 1, d), down = maxInc(c, s, 'energy', -1, d);
      return { up, down, socUp: up < maxInc(c, s, 'energy', 1, d, true) - EPS, socDn: down < maxInc(c, s, 'energy', -1, d, true) - EPS };
    }
    const amt = maxInc(c, s, m.product, 1, d);
    const soc = c.kind === 'storage' && amt < maxInc(c, s, m.product, 1, d, true) - EPS;
    return { amt, soc };
  }
  // Headroom left in each direction for display.
  function room(c, s) {
    if (c.kind === 'thermal') return { up: maxInc(c, s, 'up', 1, 0), down: maxInc(c, s, 'down', 1, 0) };
    return { up: maxInc(c, s, 'energy', 1, 0), down: maxInc(c, s, 'energy', -1, 0) };
  }
  function commit(c, s, m, v) {
    const d = num(m.duration, 1);
    const t = { ...s, E: s.E.slice(), RU: s.RU.slice(), RD: s.RD.slice() };
    if (m.product === 'energy') { t.E.push({ m, from: t.P, to: t.P + v, v }); t.P += v; }
    if (m.product === 'up' || m.product === 'sym') { t.RU.push({ m, v, e: c.kind === 'storage' ? v * d / c.etaD : 0 }); t.Rup += v; if (c.kind === 'storage') t.Eup += v * d / c.etaD; }
    if (m.product === 'down' || m.product === 'sym') { t.RD.push({ m, v, e: c.kind === 'storage' ? v * d * c.etaC : 0 }); t.Rdn += v; if (c.kind === 'storage') t.Edn += v * d * c.etaC; }
    return t;
  }

  function finalIssues(c, s) {
    const out = [];
    const bad = text => out.push({ lvl: 'bad', text });
    if (c.kind === 'thermal') {
      if (c.L > c.U + EPS) bad(`Ramp window is empty: lower limit ${fmt(c.L)} MW is above upper limit ${fmt(c.U)} MW.`);
      if (s.P < -EPS) bad(`Net output is negative (${fmt(s.P)} MW). A thermal unit can't buy back more than it sold.`);
      else if (s.P > EPS) {
        if (s.P < c.L - EPS) bad(`Output ${fmt(s.P)} MW is below the lower limit ${fmt(c.L)} MW (${c.L <= c.pmin + EPS ? 'P min' : 'ramp-down from ' + fmt(c.prevP) + ' MW'}).`);
        if (s.P > c.U + EPS) bad(`Output ${fmt(s.P)} MW is above the upper limit ${fmt(c.U)} MW (${c.U >= c.pmax - EPS ? 'P max' : 'ramp-up from ' + fmt(c.prevP) + ' MW'}).`);
        if (s.Rup > EPS && s.P + s.Rup > c.U + EPS) bad(`Positive reserve not deliverable: P + R↑ = ${fmt(s.P + s.Rup)} MW exceeds ${fmt(c.U)} MW.`);
        if (s.Rdn > EPS && s.P - s.Rdn < c.L - EPS) bad(`Negative reserve not deliverable: P − R↓ = ${fmt(s.P - s.Rdn)} MW is below ${fmt(c.L)} MW.`);
      } else {
        if (!c.canOff) bad(`Unit can't shut down this step: ramp-down from ${fmt(c.prevP)} MW only reaches ${fmt(c.L)} MW.`);
        if (s.Rup + s.Rdn > EPS) bad(`Reserves are committed but no energy is scheduled. The unit needs a must-run schedule of at least ${fmt(c.L + s.Rdn)} MW.`);
      }
    } else {
      if (s.P + s.Rup > c.pdis + EPS) bad(`Discharge power exceeded: P + R↑ = ${fmt(s.P + s.Rup)} MW > ${fmt(c.pdis)} MW.`);
      if (s.P - s.Rdn < -c.pch - EPS) bad(`Charge power exceeded: P − R↓ = ${fmt(s.P - s.Rdn)} MW < −${fmt(c.pch)} MW.`);
      const e = socEnd(c, s.P);
      if (e - s.Eup < c.emin - EPS) bad(`SOC too low: ${fmt(e)} MWh after dispatch${s.Eup > EPS ? ' minus ' + fmt(s.Eup) + ' MWh held for R↑' : ''} is below SOC min ${fmt(c.emin)} MWh.`);
      if (e + s.Edn > c.emax + EPS) bad(`SOC too high: ${fmt(e)} MWh after dispatch${s.Edn > EPS ? ' plus ' + fmt(s.Edn) + ' MWh held for R↓' : ''} exceeds capacity ${fmt(c.emax)} MWh.`);
    }
    return out;
  }

  function simulate(st) {
    const u = st.unit, dt = st.dt;
    let prevP = u.kind === 'thermal' ? clamp0(num(u.p0)) : 0;
    let soc = num(u.soc0);
    return st.steps.map(step => {
      const c = unitCtx(u, prevP, soc, dt);
      let s = emptySched();
      const startRoom = room(c, s);
      const stages = st.markets.map(m => {
        const b = step.bids[m.id];
        const av = availability(c, s, m);
        const stg = { m, bid: b, av, offer: null, acc: 0, notes: [], auto: false, before: s };
        const raw = b ? String(b.offer ?? '').trim().toLowerCase().replace(/\s+/g, '') : '';
        if (raw !== '') {
          let offer;
          if (raw === 'max' || raw === '+max') offer = m.product === 'energy' ? av.up : av.amt;
          else if (raw === '-max' || raw === '−max') offer = m.product === 'energy' ? -av.down : av.amt;
          else offer = parseFloat(raw.replace('−', '-'));
          stg.auto = raw.includes('max');
          if (!Number.isFinite(offer)) { stg.notes.push({ lvl: 'bad', text: `“${b.offer}” is not a number or max` }); offer = 0; }
          if (m.product !== 'energy') offer = Math.abs(offer);
          offer = r6(offer);
          stg.offer = offer;
          const cap = m.product === 'energy' ? (offer >= 0 ? av.up : av.down) : av.amt;
          if (Math.abs(offer) > cap + 1e-6) {
            stg.notes.push({ lvl: 'warn', text: `Offered ${fmt(Math.abs(offer))} MW, only ${fmt(cap)} MW available${(av.soc || (offer >= 0 ? av.socUp : av.socDn)) ? ' (SOC-limited)' : ''}` });
          }
          if (m.product === 'energy' && c.kind === 'thermal' && offer > EPS && s.P <= EPS && offer < av.minBlock - EPS) {
            stg.notes.push({ lvl: 'warn', text: `Below the minimum block of ${fmt(av.minBlock)} MW (lower limit + committed R↓)` });
          }
          const outcome = b.outcome in OUTCOME ? b.outcome : 'acc';
          let acc = outcome === 'rej' ? 0 : outcome === 'part' ? Math.sign(offer) * Math.min(Math.abs(num(b.accepted)), Math.abs(offer)) : offer;
          stg.acc = acc;
          stg.outcome = outcome;
          if (Math.abs(acc) > EPS) s = commit(c, s, m, acc);
        }
        stg.after = s;
        stg.room = room(c, s);
        return stg;
      });
      const issues = finalIssues(c, s);
      const res = { step, c, s, stages, issues, startRoom, room: room(c, s), socEnd: c.kind === 'storage' ? socEnd(c, s.P) : null };
      if (u.kind === 'thermal') prevP = clamp0(s.P); else soc = res.socEnd;
      return res;
    });
  }

  // ------------------------------------------------------------------ svg drawing
  const PATTERN_IDS = { xh: 'xh', lock: 'lock' };
  function svgDefs(pre) {
    let d = '<defs>';
    for (let i = 0; i < 8; i++) {
      d += `<pattern id="${pre}h${i}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        `<rect width="6" height="6" style="fill:var(--surface)"/><rect width="2.6" height="6" style="fill:var(--s${i + 1})"/></pattern>`;
    }
    d += `<pattern id="${pre}${PATTERN_IDS.lock}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">` +
      `<rect width="1" height="5" style="fill:var(--locked);fill-opacity:.75"/></pattern>`;
    d += `<pattern id="${pre}${PATTERN_IDS.xh}" width="7" height="7" patternUnits="userSpaceOnUse">` +
      `<rect width="7" height="7" style="fill:var(--surface)"/><path d="M0 0L7 7M7 0L0 7" style="stroke:var(--xh);stroke-width:1"/></pattern>`;
    return d + '</defs>';
  }
  const SVG_STYLE = `<style>
    .ax{font:11px var(--f-mono);fill:var(--muted)}
    .ax-t{font:600 11px var(--f-body);fill:var(--ink-2);letter-spacing:.06em;text-transform:uppercase}
    .grid{stroke:var(--line-2);stroke-width:1}
    .seg-lbl{font:600 10.5px var(--f-body);fill:var(--ink)}
    .free-lbl{font:600 10.5px var(--f-mono);fill:var(--free-line)}
    .det{font:11px var(--f-mono);fill:var(--ink-2)}
    .det.strong{font-weight:600;fill:var(--ink)}
    .tick-ln{stroke:var(--muted);stroke-width:1}
    .col-lbl{font:500 12px var(--f-mono);fill:var(--ink-2)}
    .col-lbl.sel{fill:var(--accent-ink);font-weight:600}
    .val{font:600 11px var(--f-mono);fill:var(--ink)}
    .val.bad{fill:var(--bad)}
    .mini-lbl{font:600 11px var(--f-body);fill:var(--ink)}
    .mini-sub{font:11px var(--f-mono);fill:var(--muted)}
    .mini-sub.acc{fill:var(--good)} .mini-sub.rej{fill:var(--bad)} .mini-sub.part{fill:var(--warn)}
    .fan{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 3;fill:none}
    .hit{fill:transparent;cursor:pointer}
  </style>`;

  function niceTicks(min, max, count = 5) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(r6(v));
    return out;
  }
  const tipAttr = t => (t ? ` data-tip="${esc(t)}"` : '');
  const fits = (text, w, px = 5.9) => text.length * px <= w - 4;

  // Split an energy segment into parts that grow |P| (drawn filled) and parts that shrink it (drawn dashed).
  function splitSeg(a, b) {
    if (a >= 0 && b >= 0) return [{ a, b, grow: b > a }];
    if (a <= 0 && b <= 0) return [{ a, b, grow: b < a }];
    return [{ a, b: 0, grow: false }, { a: 0, b, grow: true }];
  }

  function drawPowerCol(o) {
    const { c, s, rm, x, w, Y, pre, bad, mini } = o;
    const th = c.kind === 'thermal';
    const out = [];
    // Bands of an infeasible schedule can run past the axis; clip them to the plot (the red frame flags it).
    const clip = v => Math.min(c.yMax, Math.max(c.yMin, v));
    const R = (a, b, style, tip) => {
      a = clip(a); b = clip(b);
      const yTop = Y(Math.max(a, b)), h = Y(Math.min(a, b)) - yTop;
      if (!(h > 0.4)) return;
      out.push(`<rect x="${x}" y="${yTop.toFixed(2)}" width="${w}" height="${h.toFixed(2)}" style="${style}"${tipAttr(tip)}/>`);
    };
    const label = (a, b, text, cls = 'seg-lbl', alt) => {
      a = clip(a); b = clip(b);
      if (mini) return;
      const yTop = Y(Math.max(a, b)), h = Y(Math.min(a, b)) - yTop;
      if (h < 15) return;
      const t = fits(text, w) ? text : alt && fits(alt, w) ? alt : null;
      if (t) out.push(`<text x="${x + w / 2}" y="${(yTop + h / 2 + 3.8).toFixed(2)}" class="${cls}" text-anchor="middle" pointer-events="none">${esc(t)}</text>`);
    };
    const hatch = slot => `fill:url(#${pre}h${slot});stroke:var(--s${slot + 1});stroke-width:1`;
    const freeStyle = 'fill:var(--free);stroke:var(--free-line);stroke-width:1;stroke-dasharray:3 3';

    R(c.yMin, c.yMax, 'fill:var(--surface)');
    if (th) R(c.U, c.pmax, `fill:url(#${pre}xh)`, `Out of reach: ramp-up limit this step is ${fmt(c.U)} MW`);
    else {
      R(c.maxDis, c.pdis, `fill:url(#${pre}xh)`, `Discharge above ${fmt(c.maxDis)} MW is impossible: not enough energy above SOC min`);
      R(-c.pch, -c.maxCh, `fill:url(#${pre}xh)`, `Charging above ${fmt(c.maxCh)} MW is impossible: storage too full`);
    }

    // energy schedule
    for (const e of s.E) {
      const col = `var(--s${e.m.slot + 1})`;
      for (const p of splitSeg(e.from, e.to)) {
        const verb = th ? (e.v > 0 ? 'sold' : 'bought back') : (e.v > 0 ? 'discharge' : 'charge');
        if (p.grow) {
          R(p.a, p.b, `fill:${col};fill-opacity:.42;stroke:${col};stroke-width:1`, `${e.m.name}: ${signed(e.v)} MW ${verb}`);
          label(p.a, p.b, `${e.m.name} ${signed(e.v)}`, 'seg-lbl', e.m.name);
        } else {
          R(p.a, p.b, `fill:var(--surface);stroke:${col};stroke-width:1.3;stroke-dasharray:4 3`, `${e.m.name}: ${signed(e.v)} MW (reverses earlier schedule)`);
          label(p.a, p.b, signed(e.v));
        }
      }
    }

    // locked part of output (thermal)
    if (th && s.P > EPS && c.L > EPS) {
      R(0, Math.min(c.L, s.P), `fill:url(#${pre}lock)`, `Locked: output can't go below ${fmt(c.L)} MW this step (${c.L <= c.pmin + EPS ? 'P min' : 'ramp-down limit'})`);
    }

    // reserves and free bands
    const notScheduled = th && s.P <= EPS;
    if (notScheduled) {
      const lo = c.L + s.Rdn, hi = c.U - s.Rup;
      let cur = c.L;
      for (const r of s.RD) { R(cur, cur + r.v, hatch(r.m.slot), `${r.m.name}: ${fmt(r.v)} MW negative reserve (forces must-run)`); label(cur, cur + r.v, `${r.m.name} ${fmt(r.v)}`, 'seg-lbl', fmt(r.v)); cur += r.v; }
      cur = c.U;
      for (const r of s.RU) { R(cur - r.v, cur, hatch(r.m.slot), `${r.m.name}: ${fmt(r.v)} MW positive reserve`); label(cur - r.v, cur, `${r.m.name} ${fmt(r.v)}`, 'seg-lbl', fmt(r.v)); cur -= r.v; }
      if (hi > lo + EPS) {
        R(lo, hi, freeStyle, `No energy scheduled. Output can be set anywhere from ${fmt(lo)} to ${fmt(hi)} MW`);
        label(lo, hi, `free ${fmt(hi - lo)}`, 'free-lbl', fmt(hi - lo));
      }
    } else {
      let cur = s.P;
      for (const r of s.RD) {
        const tip = `${r.m.name}: ${fmt(r.v)} MW negative reserve${r.e ? `, holds ${fmt(r.e)} MWh of space` : ''}`;
        R(cur - r.v, cur, hatch(r.m.slot), tip); label(cur - r.v, cur, `${r.m.name} ${fmt(r.v)}`, 'seg-lbl', fmt(r.v)); cur -= r.v;
      }
      if (rm.down > EPS) {
        R(cur - rm.down, cur, freeStyle, `Free ↓ ${fmt(rm.down)} MW: can still be reduced or offered as negative reserve`);
        label(cur - rm.down, cur, `▼ ${fmt(rm.down)}`, 'free-lbl');
      }
      cur = s.P;
      for (const r of s.RU) {
        const tip = `${r.m.name}: ${fmt(r.v)} MW positive reserve${r.e ? `, holds ${fmt(r.e)} MWh of energy` : ''}`;
        R(cur, cur + r.v, hatch(r.m.slot), tip); label(cur, cur + r.v, `${r.m.name} ${fmt(r.v)}`, 'seg-lbl', fmt(r.v)); cur += r.v;
      }
      if (rm.up > EPS) {
        R(cur, cur + rm.up, freeStyle, `Free ↑ ${fmt(rm.up)} MW: can still be sold or offered as positive reserve`);
        label(cur, cur + rm.up, `▲ ${fmt(rm.up)}`, 'free-lbl');
      }
    }

    // reference lines
    if (th && c.pmin > EPS) out.push(`<line x1="${x}" x2="${x + w}" y1="${Y(c.pmin)}" y2="${Y(c.pmin)}" style="stroke:var(--ink-2);stroke-width:1;stroke-dasharray:4 3"/>`);
    if (!th) out.push(`<line x1="${x}" x2="${x + w}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink-2);stroke-width:1"/>`);
    if (!notScheduled) out.push(`<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(clip(s.P))}" y2="${Y(clip(s.P))}" style="stroke:var(--ink);stroke-width:${mini ? 2 : 2.5}"/>`);
    out.push(`<rect x="${x}" y="${Y(c.yMax)}" width="${w}" height="${Y(c.yMin) - Y(c.yMax)}" style="fill:none;stroke:${bad ? 'var(--bad)' : 'var(--frame)'};stroke-width:${bad ? 2 : 1}"/>`);
    return out.join('');
  }

  function drawSocCol(o) {
    const { c, s, x, w, Y, pre, soc, bad, initial } = o;
    const out = [];
    const clip = v => Math.min(c.emax, Math.max(0, v));
    const R = (a, b, style, tip) => {
      a = clip(a); b = clip(b);
      const yTop = Y(Math.max(a, b)), h = Y(Math.min(a, b)) - yTop;
      if (!(h > 0.4)) return;
      out.push(`<rect x="${x}" y="${yTop.toFixed(2)}" width="${w}" height="${h.toFixed(2)}" style="${style}"${tipAttr(tip)}/>`);
    };
    R(0, c.emax, 'fill:var(--surface)');
    R(0, Math.max(0, Math.min(soc, c.emax)), 'fill:var(--soc)', `${initial ? 'Initial SOC' : 'SOC after dispatch'}: ${fmt(soc)} MWh`);
    if (c.emin > EPS) R(0, c.emin, `fill:url(#${pre}lock)`, `Below SOC min (${fmt(c.emin)} MWh): unusable`);
    if (s) {
      let cur = soc;
      for (const r of s.RU) { R(cur - r.e, cur, `fill:url(#${pre}h${r.m.slot});stroke:var(--s${r.m.slot + 1});stroke-width:1`, `${r.m.name}: ${fmt(r.e)} MWh held for ${fmt(r.v)} MW positive reserve`); cur -= r.e; }
      cur = soc;
      for (const r of s.RD) { R(cur, cur + r.e, `fill:url(#${pre}h${r.m.slot});stroke:var(--s${r.m.slot + 1});stroke-width:1`, `${r.m.name}: ${fmt(r.e)} MWh space held for ${fmt(r.v)} MW negative reserve`); cur += r.e; }
    }
    out.push(`<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(clip(soc))}" y2="${Y(clip(soc))}" style="stroke:var(--ink);stroke-width:2.5"/>`);
    out.push(`<rect x="${x}" y="${Y(c.emax)}" width="${w}" height="${Y(0) - Y(c.emax)}" style="fill:none;stroke:${bad ? 'var(--bad)' : 'var(--frame)'};stroke-width:${bad ? 2 : 1}"/>`);
    return out.join('');
  }

  function sideLabels(items, x, Y, minGap = 13) {
    const arr = items.filter(it => Number.isFinite(it.v)).map(it => ({ ...it, y0: Y(it.v), y: Y(it.v) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < arr.length; i++) if (arr[i].y - arr[i - 1].y < minGap) arr[i].y = arr[i - 1].y + minGap;
    return arr.map(it => `<path d="M${x} ${it.y0}L${x + 5} ${it.y0}L${x + 9} ${it.y}" class="tick-ln" fill="none"/>` +
      `<text x="${x + 12}" y="${(it.y + 3.8).toFixed(2)}" class="det${it.strong ? ' strong' : ''}">${esc(it.text)}</text>`).join('');
  }

  function yAxis(Y, min, max, x0, x1, specials) {
    let g = '';
    const sp = specials.filter(v => Number.isFinite(v.v));
    for (const t of niceTicks(min, max, 5)) {
      g += `<line x1="${x0}" x2="${x1}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/>`;
      if (sp.some(v => Math.abs(Y(v.v) - Y(t)) < 11)) continue;
      g += `<text x="${x0 - 8}" y="${Y(t) + 3.5}" class="ax" text-anchor="end">${fmt(t)}</text>`;
    }
    for (const v of sp) g += `<text x="${x0 - 8}" y="${Y(v.v) + 3.5}" class="ax" text-anchor="end" style="fill:var(--ink-2)">${esc(v.text)}</text>`;
    return g;
  }

  function renderChart() {
    const u = state.unit, storage = u.kind === 'storage';
    const n = sim.length + 1;
    const colW = 58, gap = 100, left = 100, right = 118, top = 34;
    const Hp = storage ? 250 : 320, Hs = storage ? 170 : 0, between = storage ? 58 : 0, bottom = 40;
    const W = left + n * colW + (n - 1) * gap + right;
    const H = top + Hp + between + Hs + bottom;
    const c0 = unitCtx(u, storage ? 0 : clamp0(num(u.p0)), num(u.soc0), state.dt);
    const pMin = c0.yMin, pMax = c0.yMax > pMin ? c0.yMax : pMin + 1;
    const Yp = v => top + (pMax - v) / (pMax - pMin) * Hp;
    const colX = i => left + i * (colW + gap);
    const pre = 'c-';
    const x0 = left - 14, x1 = W - right + 40;

    let g = SVG_STYLE + svgDefs(pre);
    g += `<rect x="0" y="0" width="${W}" height="${H}" style="fill:var(--surface)"/>`;
    // selected column highlight
    const sx = colX(state.sel + 1);
    g += `<rect x="${sx - 14}" y="${top - 26}" width="${colW + 28}" height="${H - top + 24}" rx="6" style="fill:var(--sel-bg)"/>`;

    g += `<text x="${x0 - 8}" y="${top - 16}" class="ax-t" text-anchor="end">${storage ? 'Power MW' : 'MW'}</text>`;
    const specials = storage ? [{ v: 0, text: '0' }] : [{ v: c0.pmin, text: `Pmin ${fmt(c0.pmin)}` }, { v: c0.pmax, text: `Pmax ${fmt(c0.pmax)}` }];
    g += yAxis(Yp, pMin, pMax, x0, x1, specials);

    // initial column
    {
      const x = colX(0);
      g += `<g data-step="-1">`;
      if (storage) {
        g += `<rect x="${x}" y="${Yp(pMax)}" width="${colW}" height="${Hp}" style="fill:var(--surface-2);stroke:var(--line);stroke-width:1"/>`;
        g += `<line x1="${x}" x2="${x + colW}" y1="${Yp(0)}" y2="${Yp(0)}" style="stroke:var(--ink-2)"/>`;
      } else {
        const p0 = c0.prevP;
        g += `<rect x="${x}" y="${Yp(pMax)}" width="${colW}" height="${Hp}" style="fill:var(--surface)"/>`;
        if (p0 > EPS) g += `<rect x="${x}" y="${Yp(p0)}" width="${colW}" height="${Yp(0) - Yp(p0)}" style="fill:var(--soc)"${tipAttr(`Output before the first step: ${fmt(p0)} MW`)}/>`;
        if (c0.pmin > EPS) g += `<line x1="${x}" x2="${x + colW}" y1="${Yp(c0.pmin)}" y2="${Yp(c0.pmin)}" style="stroke:var(--ink-2);stroke-dasharray:4 3"/>`;
        g += `<line x1="${x - 2}" x2="${x + colW + 2}" y1="${Yp(p0)}" y2="${Yp(p0)}" style="stroke:var(--ink);stroke-width:2.5"/>`;
        g += `<rect x="${x}" y="${Yp(pMax)}" width="${colW}" height="${Hp}" style="fill:none;stroke:var(--frame)"/>`;
        g += `<text x="${x + colW / 2}" y="${top - 8}" class="val" text-anchor="middle">${fmt(p0)}</text>`;
      }
      g += `</g>`;
      g += `<text x="${x + colW / 2}" y="${H - 14}" class="col-lbl" text-anchor="middle">t₀</text>`;
    }

    sim.forEach((r, i) => {
      const x = colX(i + 1), selected = i === state.sel;
      const bad = r.issues.length > 0;
      // ramp fan from previous output to this step's window (as on the hand-drawn slides)
      if (!storage) {
        const xp = colX(i) + colW, yp = Yp(r.c.prevP);
        g += `<path class="fan" d="M${xp} ${yp}L${x} ${Yp(r.c.U)}M${xp} ${yp}L${x} ${Yp(Math.min(r.c.L, r.c.U))}"/>`;
      }
      g += `<g data-step="${i}" style="cursor:pointer">`;
      g += `<rect class="hit" x="${x - 14}" y="${top - 26}" width="${colW + 28}" height="${H - top + 24}"/>`;
      g += drawPowerCol({ c: r.c, s: r.s, rm: r.room, x, w: colW, Y: Yp, pre, bad });
      g += `</g>`;
      const pv = r.c.kind === 'thermal' && r.s.P <= EPS ? 'off' : fmt(r.s.P);
      g += `<text x="${x + colW / 2}" y="${top - 8}" class="val${bad ? ' bad' : ''}" text-anchor="middle"${bad ? tipAttr(r.issues.map(z => z.text).join(' ')) : ''}>${bad ? '⚠ ' : ''}${pv}</text>`;
      if (selected) {
        const items = [];
        if (storage) {
          items.push({ v: r.s.P, text: `P ${signed(r.s.P)}`, strong: true });
          items.push({ v: r.c.pdis, text: `dis. max ${fmt(r.c.pdis)}` });
          items.push({ v: -r.c.pch, text: `ch. max ${fmt(r.c.pch)}` });
        } else {
          if (r.c.U < r.c.pmax - EPS) items.push({ v: r.c.U, text: `ramp ↑ ${fmt(r.c.U)}` });
          items.push(r.s.P > EPS ? { v: r.s.P, text: `P ${fmt(r.s.P)}`, strong: true } : { v: 0, text: 'P 0 (off)', strong: true });
          if (r.c.L > r.c.pmin + EPS) items.push({ v: r.c.L, text: `ramp ↓ ${fmt(r.c.L)}` });
        }
        g += sideLabels(items, x + colW + 3, Yp);
      }
      const lbl = esc(r.step.label);
      if (selected) {
        const tw = Math.max(34, lbl.length * 8 + 16);
        g += `<rect x="${x + colW / 2 - tw / 2}" y="${H - 29}" width="${tw}" height="21" rx="10.5" style="fill:var(--accent)"/>`;
      }
      g += `<text x="${x + colW / 2}" y="${H - 14}" class="col-lbl${selected ? ' sel' : ''}" text-anchor="middle" data-step="${i}" style="cursor:pointer">${lbl}</text>`;
    });

    if (storage) {
      const topS = top + Hp + between;
      const emax = c0.emax > 0 ? c0.emax : 1;
      const Ys = v => topS + (emax - v) / emax * Hs;
      g += `<text x="${x0 - 8}" y="${topS - 16}" class="ax-t" text-anchor="end">SOC MWh</text>`;
      g += yAxis(Ys, 0, emax, x0, x1, c0.emin > EPS ? [{ v: c0.emin, text: `min ${fmt(c0.emin)}` }] : []);
      g += drawSocCol({ c: c0, s: null, x: colX(0), w: colW, Y: Ys, pre, soc: c0.soc, initial: true });
      g += `<text x="${colX(0) + colW / 2}" y="${topS - 8}" class="val" text-anchor="middle">${fmt(c0.soc)}</text>`;
      sim.forEach((r, i) => {
        const x = colX(i + 1);
        g += `<path class="fan" d="M${colX(i) + colW} ${Ys(r.c.soc)}L${x} ${Ys(r.socEnd)}"/>`;
        g += `<g data-step="${i}" style="cursor:pointer">`;
        g += drawSocCol({ c: r.c, s: r.s, x, w: colW, Y: Ys, pre, soc: r.socEnd, bad: r.issues.length > 0 });
        g += `</g>`;
        g += `<text x="${x + colW / 2}" y="${topS - 8}" class="val" text-anchor="middle">${fmt(r.socEnd)}</text>`;
        if (i === state.sel) {
          const items = [{ v: r.socEnd, text: `SOC ${fmt(r.socEnd)}`, strong: true }];
          if (r.s.Eup > EPS) items.push({ v: r.socEnd - r.s.Eup, text: `−${fmt(r.s.Eup)} R↑` });
          if (r.s.Edn > EPS) items.push({ v: r.socEnd + r.s.Edn, text: `+${fmt(r.s.Edn)} R↓` });
          g += sideLabels(items, x + colW + 3, Ys);
        }
      });
    }

    const svg = $('#chart');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = g;
    $('#chartSub').textContent = `${u.name} · ${storage ? `${fmt(c0.pdis)} MW / ${fmt(c0.emax)} MWh` : `${fmt(c0.pmin)}–${fmt(c0.pmax)} MW`} · ${sim.length} step${sim.length === 1 ? '' : 's'} of ${fmt(state.dt)} h`;
  }

  function renderSeq() {
    const r = sim[state.sel];
    if (!r) return;
    const storage = r.c.kind === 'storage';
    $('#stepLabel').value = r.step.label;

    // issues
    const notes = [];
    r.issues.forEach(z => notes.push(`<div class="issue bad"><b>Infeasible</b><span>${esc(z.text)}</span></div>`));
    r.stages.forEach(stg => stg.notes.forEach(z => notes.push(`<div class="issue ${z.lvl}"><b>${esc(stg.m.name)}</b><span>${esc(z.text)}</span></div>`)));
    if (!notes.length) notes.push(`<div class="issue ok"><b>Feasible</b><span>All accepted bids in ${esc(r.step.label)} can be delivered${storage ? ', including the energy held for reserves' : ''}.</span></div>`);
    $('#issues').innerHTML = notes.join('');

    // mini columns: state before clearing, then after each market
    const cols = [{ label: 'Start', sub: storage ? `SOC ${fmt(r.c.soc)}` : `t−1: ${fmt(r.c.prevP)}`, s: emptySched(), rm: r.startRoom, cls: '' }]
      .concat(r.stages.map(stg => {
        let sub = '– no bid', cls = '';
        if (stg.offer != null) {
          cls = stg.outcome;
          sub = stg.outcome === 'rej' ? `✗ ${fmt(stg.offer)}` : `${stg.outcome === 'part' ? '◐' : '✓'} ${stg.m.product === 'energy' ? signed(stg.acc) : fmt(stg.acc)}`;
        }
        return { label: stg.m.name, sub, cls, s: stg.after, rm: stg.room, m: stg.m };
      }));
    const colW = 36, gap = 74, left = 56, top = 16, Hm = 180, bottom = 66;
    const W = left + cols.length * colW + (cols.length - 1) * gap + 30;
    const H = top + Hm + bottom;
    const c = r.c;
    const pMin = c.yMin, pMax = c.yMax > pMin ? c.yMax : pMin + 1;
    const Y = v => top + (pMax - v) / (pMax - pMin) * Hm;
    const pre = 'q-';
    let g = SVG_STYLE + svgDefs(pre) + `<rect x="0" y="0" width="${W}" height="${H}" style="fill:var(--surface)"/>`;
    g += yAxis(Y, pMin, pMax, left - 12, W - 10, storage ? [{ v: 0, text: '0' }] : [{ v: c.pmin, text: 'Pmin' }]);
    cols.forEach((col, i) => {
      const x = left + i * (colW + gap);
      if (i > 0) g += `<text x="${x - gap / 2}" y="${top + Hm / 2}" text-anchor="middle" class="mini-sub" style="font-size:16px">→</text>`;
      g += drawPowerCol({ c, s: col.s, rm: col.rm, x, w: colW, Y, pre, mini: true, bad: i === cols.length - 1 && r.issues.length > 0 });
      const name = col.label.length > 12 ? col.label.slice(0, 11) + '…' : col.label;
      const cx = x + colW / 2;
      if (col.m) g += `<rect x="${cx - 4}" y="${H - bottom + 9}" width="8" height="8" rx="1.5" style="fill:var(--s${col.m.slot + 1})"/>`;
      g += `<text x="${cx}" y="${H - bottom + 32}" class="mini-lbl" text-anchor="middle"${tipAttr(col.label)}>${esc(name)}</text>`;
      g += `<text x="${cx}" y="${H - bottom + 47}" class="mini-sub ${col.cls}" text-anchor="middle">${esc(col.sub)}</text>`;
      g += `<text x="${cx}" y="${H - bottom + 62}" class="mini-sub" text-anchor="middle"${tipAttr(`Free ↑ ${fmt(col.rm.up)} MW · free ↓ ${fmt(col.rm.down)} MW`)}>↑${fmt(col.rm.up, 1)} ↓${fmt(col.rm.down, 1)}</text>`;
    });
    const svg = $('#seq');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = g;

    // ledger
    let t = `<thead><tr><th>#</th><th>Market</th><th>Product</th><th>Available</th><th>Offered</th><th>Outcome</th><th>Accepted</th><th>Free ↑ after</th><th>Free ↓ after</th><th>Notes</th></tr></thead><tbody>`;
    r.stages.forEach((stg, i) => {
      const m = stg.m, en = m.product === 'energy';
      const avail = en ? `↑ ${fmt(stg.av.up)} / ↓ ${fmt(stg.av.down)}` : fmt(stg.av.amt);
      const has = stg.offer != null;
      const oc = has ? `<span class="pill ${stg.outcome === 'acc' ? 'ok' : stg.outcome === 'rej' ? 'bad' : 'warn'}">${OUTCOME[stg.outcome]}</span>` : '–';
      const nts = stg.notes.map(z => `<span class="note-${z.lvl}">${esc(z.text)}</span>`).join('<br>') ||
        ((stg.av.soc || stg.av.socUp || stg.av.socDn) ? '<span class="sub">Availability limited by SOC</span>' : '');
      t += `<tr class="${has ? '' : 'muted'}"><td>${i + 1}</td><td><span class="mcell"><span class="sw" style="--c:var(--s${m.slot + 1})" data-prod="${m.product}"></span>${esc(m.name)}</span></td>` +
        `<td>${PRODUCTS[m.product].tag}${!en && storage ? ` · ${fmt(m.duration)} h` : ''}</td><td>${avail}</td>` +
        `<td>${has ? (en ? signed(stg.offer) : fmt(stg.offer)) + (stg.auto ? ' <span class="sub">(max)</span>' : '') : '–'}</td>` +
        `<td>${oc}</td><td>${has ? (en ? signed(stg.acc) : fmt(stg.acc)) : '–'}</td><td>${fmt(stg.room.up)}</td><td>${fmt(stg.room.down)}</td><td>${nts}</td></tr>`;
    });
    t += `</tbody>`;
    const unitNote = storage ? `P ${signed(r.s.P)} MW · SOC ${fmt(r.c.soc)} → ${fmt(r.socEnd)} MWh` : `P ${fmt(r.s.P)} MW · window ${fmt(r.c.L)}–${fmt(r.c.U)} MW`;
    t += `<tfoot><tr><td></td><td colspan="9" class="sub" style="text-align:left;font-family:var(--f-body)">End of ${esc(r.step.label)}: ${unitNote} · reserves held ↑ ${fmt(r.s.Rup)} / ↓ ${fmt(r.s.Rdn)} MW</td></tr></tfoot>`;
    $('#ledger').innerHTML = t;
  }

  // ------------------------------------------------------------------ side panels and grid
  const UNIT_FIELDS = {
    thermal: [['pmax', 'P max', 'MW'], ['pmin', 'P min', 'MW'], ['ru', 'Ramp up', 'MW/step'], ['rd', 'Ramp down', 'MW/step'], ['p0', 'Output at t₀', 'MW']],
    storage: [['pdis', 'Discharge max', 'MW'], ['pch', 'Charge max', 'MW'], ['emax', 'Capacity', 'MWh'], ['emin', 'SOC min', 'MWh'], ['soc0', 'SOC at t₀', 'MWh'], ['etaC', 'η charge', ''], ['etaD', 'η discharge', '']],
  };
  function renderUnit() {
    const u = state.unit;
    $('#unitName').value = u.name;
    $$('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === u.kind)));
    const f = UNIT_FIELDS[u.kind].concat([['dt', 'Step length Δt', 'h']]);
    $('#unitFields').innerHTML = f.map(([k, l, unit]) =>
      `<label class="field"><span>${l}</span><span class="inwrap"><input id="u-${k}" data-ukey="${k}" type="number" step="any" inputmode="decimal" value="${esc(k === 'dt' ? state.dt : u[k])}">${unit ? `<i>${unit}</i>` : ''}</span></label>`).join('');
  }

  function renderMarkets() {
    const storage = state.unit.kind === 'storage', M = state.markets;
    $('#marketList').innerHTML = M.map((m, i) => `
      <li class="mrow" data-mid="${m.id}">
        <span class="order">${i + 1}</span>
        <button type="button" class="swatch" data-act="color" style="--c:var(--s${m.slot + 1})" title="Change colour" aria-label="Change colour of ${esc(m.name)}"></button>
        <input class="mname" id="mn-${m.id}" data-mf="name" value="${esc(m.name)}" aria-label="Market name" autocomplete="off">
        <span class="mbtns">
          <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Clear earlier" title="Clear earlier">↑</button>
          <button type="button" data-act="down" ${i === M.length - 1 ? 'disabled' : ''} aria-label="Clear later" title="Clear later">↓</button>
          <button type="button" data-act="del" aria-label="Remove ${esc(m.name)}" title="Remove">×</button>
        </span>
        <span class="prod">
          <select id="mp-${m.id}" data-mf="product" aria-label="Product of ${esc(m.name)}">${Object.entries(PRODUCTS).map(([k, p]) => `<option value="${k}"${k === m.product ? ' selected' : ''}>${p.label}</option>`).join('')}</select>
          ${storage && m.product !== 'energy' ? `<label class="dur" title="Activation duration the storage must be able to sustain">for<input id="md-${m.id}" data-mf="duration" type="number" step="any" min="0" value="${esc(m.duration)}">h</label>` : ''}
        </span>
      </li>`).join('');
    $('#addMarket').disabled = M.length >= 8;
  }

  function renderLegend() {
    const storage = state.unit.kind === 'storage';
    const items = state.markets.map(m => `<span><i class="sw" style="--c:var(--s${m.slot + 1})" data-prod="${m.product}"></i>${esc(m.name)}</span>`);
    items.push('<span class="sep" aria-hidden="true"></span>');
    items.push('<span><i class="lg-key lg-free"></i>Free headroom</span>');
    items.push('<span><i class="lg-key lg-wd"></i>Reversed schedule</span>');
    items.push(`<span><i class="lg-key lg-lock"></i>${storage ? 'Below SOC min' : 'Locked (Pmin / ramp ↓)'}</span>`);
    items.push(`<span><i class="lg-key lg-xh"></i>${storage ? 'Blocked by SOC' : 'Beyond ramp ↑'}</span>`);
    if (storage) items.push('<span><i class="lg-key lg-soc"></i>Stored energy</span>');
    $('#legend').innerHTML = items.join('');
  }

  function renderGrid() {
    const S = state.steps, M = state.markets, storage = state.unit.kind === 'storage';
    const sc = i => (i === state.sel ? ' sel' : '');
    let h = '<thead><tr><th class="corner" scope="col">Market</th>';
    S.forEach((s, i) => {
      h += `<th scope="col" class="stepcol${sc(i)}"><button type="button" class="steptab" data-act="sel" data-step="${i}">${esc(s.label)}</button>` +
        (S.length > 1 ? `<button type="button" class="x" data-act="delstep" data-step="${i}" aria-label="Remove ${esc(s.label)}" title="Remove step">×</button>` : '') + '</th>';
    });
    h += `<th><button type="button" class="btn small" data-act="addstep">+ Step</button></th></tr></thead><tbody>`;
    if (!M.length) h += `<tr><td colspan="${S.length + 2}" class="sub">Add a market on the left to start placing bids.</td></tr>`;
    M.forEach(m => {
      h += `<tr><th scope="row" class="mhead"><span class="sw" style="--c:var(--s${m.slot + 1})" data-prod="${m.product}"></span><span data-rowname="${m.id}">${esc(m.name)}</span><small>${PRODUCTS[m.product].tag}</small></th>`;
      S.forEach((s, i) => {
        const b = s.bids[m.id] || { offer: '', outcome: 'acc', accepted: '' };
        const empty = String(b.offer).trim() === '';
        h += `<td class="${sc(i).trim()}"><div class="cell${empty ? ' empty' : ''}" data-step="${i}" data-mid="${m.id}">` +
          `<input class="offer" id="o-${i}-${m.id}" value="${esc(b.offer)}" placeholder="no bid" aria-label="Offer ${esc(m.name)} in ${esc(s.label)}" autocomplete="off" spellcheck="false">` +
          `<button type="button" class="oc" data-act="oc" data-o="${b.outcome}" title="Switch outcome" aria-label="Outcome ${esc(m.name)} in ${esc(s.label)}: ${OUTCOME[b.outcome]}">${OUTCOME[b.outcome]}</button>` +
          `<input class="accv" id="a-${i}-${m.id}" value="${esc(b.accepted)}" placeholder="accepted MW" aria-label="Accepted volume" autocomplete="off" ${b.outcome === 'part' ? '' : 'hidden'}>` +
          `<span class="hint"></span></div></td>`;
      });
      h += '<td></td></tr>';
    });
    h += '</tbody><tfoot>';
    const foot = [['P', storage ? 'Net power P' : 'Output P'], ['up', 'Free ↑'], ['down', 'Free ↓']];
    if (storage) foot.push(['soc', 'SOC end']);
    foot.push(['status', 'Status']);
    foot.forEach(([k, l]) => {
      h += `<tr><th scope="row">${l}</th>` + S.map((s, i) => `<td class="${sc(i).trim()}" data-foot="${k}" data-step="${i}"></td>`).join('') + '<td></td></tr>';
    });
    h += '</tfoot>';
    $('#bidGrid').innerHTML = h;
  }

  function updateGridComputed() {
    sim.forEach((r, i) => {
      r.stages.forEach(stg => {
        const cell = $(`.cell[data-step="${i}"][data-mid="${stg.m.id}"]`);
        if (!cell) return;
        const hint = cell.querySelector('.hint');
        const worst = stg.notes.find(z => z.lvl === 'bad') || stg.notes.find(z => z.lvl === 'warn');
        let text = '';
        if (stg.offer != null) {
          if (stg.auto) text = `= ${stg.m.product === 'energy' ? signed(stg.offer) : fmt(stg.offer)}`;
          if (worst) text = (text ? text + ' · ' : '') + (worst.lvl === 'bad' ? 'invalid' : `> ${fmt(stg.m.product === 'energy' ? (stg.offer >= 0 ? stg.av.up : stg.av.down) : stg.av.amt)} avail`);
        } else {
          const a = stg.m.product === 'energy' ? `↑${fmt(stg.av.up, 1)} ↓${fmt(stg.av.down, 1)}` : fmt(stg.av.amt, 1);
          text = `avail ${a}`;
        }
        hint.textContent = text;
        hint.className = 'hint' + (worst ? ' ' + worst.lvl : '');
        hint.title = worst ? worst.text : '';
        cell.classList.toggle('empty', stg.offer == null);
      });
      const set = (k, html) => { const td = $(`td[data-foot="${k}"][data-step="${i}"]`); if (td) td.innerHTML = html; };
      set('P', r.c.kind === 'thermal' && r.s.P <= EPS ? 'off' : (r.c.kind === 'storage' ? signed(r.s.P) : fmt(r.s.P)) + ' MW');
      set('up', fmt(r.room.up) + ' MW');
      set('down', fmt(r.room.down) + ' MW');
      if (r.socEnd != null) set('soc', fmt(r.socEnd) + ' MWh');
      const warns = r.stages.reduce((a, s) => a + s.notes.length, 0);
      set('status', r.issues.length
        ? `<button type="button" class="pill bad" data-act="sel" data-step="${i}">⚠ ${r.issues.length} issue${r.issues.length > 1 ? 's' : ''}</button>`
        : warns ? `<button type="button" class="pill warn" data-act="sel" data-step="${i}">! ${warns} warning${warns > 1 ? 's' : ''}</button>`
          : `<span class="pill ok">✓ feasible</span>`);
    });
  }

  function update() {
    sim = simulate(state);
    renderChart();
    renderSeq();
    updateGridComputed();
    save();
  }
  function renderAll() {
    renderUnit();
    renderMarkets();
    renderLegend();
    renderGrid();
    update();
  }
  function select(i) {
    state.sel = Math.min(Math.max(0, i), state.steps.length - 1);
    $$('#bidGrid .sel').forEach(el => el.classList.remove('sel'));
    $$('#bidGrid th.stepcol').forEach((th, j) => th.classList.toggle('sel', j === state.sel));
    $$('#bidGrid tbody tr, #bidGrid tfoot tr').forEach(tr => {
      const cells = Array.from(tr.children).slice(1, 1 + state.steps.length);
      cells.forEach((td, j) => td.classList.toggle('sel', j === state.sel));
    });
    update();
  }

  // ------------------------------------------------------------------ events
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function getBid(i, mid, create) {
    const st = state.steps[i];
    if (!st.bids[mid] && create) st.bids[mid] = { offer: '', outcome: 'acc', accepted: '' };
    return st.bids[mid];
  }
  function cleanupBid(i, mid) {
    const b = state.steps[i].bids[mid];
    if (b && String(b.offer).trim() === '' && b.outcome === 'acc' && String(b.accepted).trim() === '') delete state.steps[i].bids[mid];
  }

  document.addEventListener('click', e => {
    const kindBtn = e.target.closest('[data-kind]');
    if (kindBtn) { state.unit.kind = kindBtn.dataset.kind; renderAll(); return; }

    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      const li = act.closest('.mrow');
      if (li) {
        const idx = state.markets.findIndex(m => m.id === li.dataset.mid);
        const m = state.markets[idx];
        if (a === 'color') {
          const used = new Set(state.markets.map(x => x.slot));
          for (let k = 1; k <= 8; k++) { const s = (m.slot + k) % 8; if (!used.has(s) || k === 8) { m.slot = s; break; } }
        } else if (a === 'up' && idx > 0) state.markets.splice(idx - 1, 0, state.markets.splice(idx, 1)[0]);
        else if (a === 'down' && idx < state.markets.length - 1) state.markets.splice(idx + 1, 0, state.markets.splice(idx, 1)[0]);
        else if (a === 'del') { state.markets.splice(idx, 1); state.steps.forEach(st => delete st.bids[m.id]); toast(`Removed ${m.name}`); }
        renderAll();
        return;
      }
      if (a === 'sel') { select(+act.dataset.step); return; }
      if (a === 'delstep') {
        const i = +act.dataset.step;
        const lbl = state.steps[i].label;
        state.steps.splice(i, 1);
        if (state.sel >= state.steps.length) state.sel = state.steps.length - 1;
        renderAll();
        toast(`Removed step ${lbl}`);
        return;
      }
      if (a === 'addstep') {
        const last = state.steps[state.steps.length - 1];
        const used = new Set(state.steps.map(s => s.label));
        let k = state.steps.length + 1;
        while (used.has('t' + k)) k++;
        state.steps.push({ label: 't' + k, bids: last ? clone(last.bids) : {} });
        state.sel = state.steps.length - 1;
        renderAll();
        return;
      }
      if (a === 'oc') {
        const cell = act.closest('.cell');
        const i = +cell.dataset.step, mid = cell.dataset.mid;
        const b = getBid(i, mid, true);
        b.outcome = NEXT_OUTCOME[b.outcome] || 'acc';
        if (b.outcome === 'part' && String(b.accepted).trim() === '') {
          const stg = sim[i] && sim[i].stages.find(s => s.m.id === mid);
          if (stg && stg.offer != null) b.accepted = String(r6(Math.abs(stg.offer) / 2));
        }
        act.dataset.o = b.outcome;
        act.textContent = OUTCOME[b.outcome];
        act.setAttribute('aria-label', act.getAttribute('aria-label').replace(/: .*$/, ': ' + OUTCOME[b.outcome]));
        const accv = cell.querySelector('.accv');
        accv.hidden = b.outcome !== 'part';
        accv.value = b.accepted;
        cleanupBid(i, mid);
        update();
        return;
      }
    }

    const addM = e.target.closest('#addMarket');
    if (addM) {
      if (state.markets.length >= 8) return;
      const used = new Set(state.markets.map(m => m.slot));
      let slot = 0; while (used.has(slot)) slot++;
      state.markets.push(mk(`Market ${state.markets.length + 1}`, 'energy', slot));
      renderAll();
      const inp = $(`#mn-${state.markets[state.markets.length - 1].id}`);
      if (inp) { inp.focus(); inp.select(); }
      return;
    }

    const stepEl = e.target.closest('svg [data-step]');
    if (stepEl && +stepEl.dataset.step >= 0) { select(+stepEl.dataset.step); return; }

    const exp = e.target.closest('[data-export]');
    if (exp) { $('#exportMenu').open = false; doExport(exp.dataset.export); return; }

    if (e.target.closest('#copyLink')) { copyLink(); return; }

    const menu = $('#exportMenu');
    if (menu.open && !e.target.closest('#exportMenu')) menu.open = false;
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'unitName') { state.unit.name = t.value; update(); return; }
    if (t.dataset.ukey) {
      const k = t.dataset.ukey;
      if (k === 'dt') { const v = num(t.value, NaN); if (v > 0) state.dt = v; }
      else state.unit[k] = num(t.value, 0);
      update();
      return;
    }
    if (t.dataset.mf && t.dataset.mf !== 'product') {
      const m = state.markets.find(x => x.id === t.closest('.mrow').dataset.mid);
      if (t.dataset.mf === 'name') {
        m.name = t.value;
        const rn = $(`[data-rowname="${m.id}"]`); if (rn) rn.textContent = m.name;
        renderLegend();
      } else m.duration = num(t.value, 0);
      update();
      return;
    }
    if (t.classList.contains('offer') || t.classList.contains('accv')) {
      const cell = t.closest('.cell');
      const i = +cell.dataset.step, mid = cell.dataset.mid;
      const b = getBid(i, mid, true);
      if (t.classList.contains('offer')) b.offer = t.value; else b.accepted = t.value;
      cleanupBid(i, mid);
      update();
      return;
    }
    if (t.id === 'stepLabel') {
      const st = state.steps[state.sel];
      st.label = t.value || st.label;
      const tab = $(`.steptab[data-step="${state.sel}"]`); if (tab) tab.textContent = st.label;
      update();
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.mf === 'product') {
      const m = state.markets.find(x => x.id === t.closest('.mrow').dataset.mid);
      m.product = t.value;
      renderAll();
      return;
    }
    if (t.id === 'preset' && t.value) {
      state = normalize(PRESETS[t.value]());
      const name = t.options[t.selectedIndex].text;
      t.value = '';
      renderAll();
      toast(`Loaded “${name}”`);
      return;
    }
    if (t.id === 'importFile' && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try { state = normalize(JSON.parse(reader.result)); renderAll(); toast('Scenario imported'); }
        catch (err) { toast('That file is not a valid scenario JSON'); }
      };
      reader.readAsText(t.files[0]);
      t.value = '';
      $('#exportMenu').open = false;
    }
  });

  // tooltip
  const tip = $('#tip');
  function showTip(target, x, y) {
    tip.textContent = target.getAttribute('data-tip');
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + tw > window.innerWidth - 8) left = x - tw - 14;
    if (top + th > window.innerHeight - 8) top = y - th - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  ['#chart', '#seq'].forEach(sel => {
    const el = $(sel);
    el.addEventListener('mousemove', e => {
      const t = e.target.closest('[data-tip]');
      if (t) showTip(t, e.clientX, e.clientY); else tip.hidden = true;
    });
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // ------------------------------------------------------------------ export / share
  function resolvedSvg(svgEl) {
    const cs = getComputedStyle(document.documentElement);
    let s = svgEl.outerHTML;
    for (let k = 0; k < 3; k++) s = s.replace(/var\((--[\w-]+)\)/g, (_, name) => cs.getPropertyValue(name).trim() || '#000');
    if (!s.includes('xmlns=')) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    return s;
  }
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fileBase = () => (state.unit.name || 'unit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unit';
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
  function doExport(kind) {
    const svgEl = $('#chart');
    if (kind === 'json') download(`${fileBase()}-scenario.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    if (kind === 'copyjson') copyText(JSON.stringify(state, null, 2), 'Scenario JSON copied');
    if (kind === 'svg') download(`${fileBase()}-headroom.svg`, new Blob([resolvedSvg(svgEl)], { type: 'image/svg+xml' }));
    if (kind === 'png') {
      const w = +svgEl.getAttribute('width'), h = +svgEl.getAttribute('height'), scale = 2;
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = w * scale; cv.height = h * scale;
        const ctx = cv.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        cv.toBlob(b => b && download(`${fileBase()}-headroom.png`, b), 'image/png');
      };
      img.onerror = () => toast('PNG export failed. Try SVG instead.');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(resolvedSvg(svgEl));
    }
  }
  function copyLink() {
    const url = location.origin + location.pathname + '#s=' + b64enc(JSON.stringify(packState(state)));
    copyText(url, 'Link copied. It contains the full scenario.');
  }

  renderAll();
})();

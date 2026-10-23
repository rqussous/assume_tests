/* Test code beside the chart.
 *   annotate(code, opt)        splits an ASSUME test function into lines and finds what each line reads or changes
 *   generate(sc, kind, sim, o) writes a pytest test for a scenario, with the same kind of line links
 *   tokens(line)               Python syntax classes for highlighting
 * A link points at something in the chart:
 *   { what: 'band',  h, product }     energy / capacity_pos / capacity_neg accepted in hour h
 *   { what: 'value', h, stage, key }  a return value (model.js checkValue keys) at a stage of hour h
 *   { what: 'soc',   h }              soc at the start of hour h (h = hours means the end of the last hour)
 *   { what: 'exec' | 'prev' | 'op' | 'hour', h }   execute_current_dispatch, previous_power, op_time, the whole column
 *   { what: 'offer', h, n }           volume bid to market n
 *   { what: 'unit',  attr }           a unit parameter, all hours
 * Pure functions, no DOM, so it runs in Node too. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- reading ASSUME tests
  const CALL_KEYS = {
    calculate_min_max_discharge: ['disMin', 'disMax'], calculate_min_max_charge: ['chMin', 'chMax'], calculate_min_max_power: ['min', 'max'],
    calculate_ramp_discharge: ['rampDis'], calculate_ramp_charge: ['rampCh'], calculate_ramp: ['rampMax'],
    get_operation_time: ['op'], execute_current_dispatch: ['exec'],
  };
  const UNIT_ATTRS = /^\s*\w+\.(max_power_charge|max_power_discharge|min_power_charge|min_power_discharge|max_power|min_power|ramp_up_charge|ramp_down_charge|ramp_up_discharge|ramp_down_discharge|ramp_up|ramp_down|min_operating_time|min_down_time|capacity|initial_soc|min_soc|max_soc)\s*=(?!=)/;

  // Groups continuation lines by bracket depth: [{ from, to, text }]
  function statements(lines) {
    const out = [];
    let from = 0, depth = 0, buf = [];
    lines.forEach((l, i) => {
      const bare = l.replace(/"[^"]*"|'[^']*'/g, '""').replace(/#.*$/, '');
      for (const c of bare) { if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; }
      buf.push(l.trim());
      if (depth <= 0) { out.push({ from, to: i, text: buf.join(' ') }); buf = []; from = i + 1; depth = 0; }
    });
    if (buf.length) out.push({ from, to: lines.length - 1, text: buf.join(' ') });
    return out;
  }
  // hour offset of an outputs[...] subscript relative to start
  function offsetOf(sub) {
    if (/\[\s*end\s*\]/.test(sub)) return 1;
    let m;
    if ((m = sub.match(/start\s*-\s*[\w.]*freq\s*\*\s*(\d+)/))) return -m[1];
    if ((m = sub.match(/start\s*-\s*(?:pd\.)?timedelta\(hours=(\d+)\)/i))) return -m[1];
    if (/start\s*-/.test(sub)) return -1;
    if ((m = sub.match(/start\s*\+\s*(?:pd\.)?timedelta\(hours=(\d+)\)/i))) return +m[1];
    return 0;
  }
  const valueLink = v => (v.key === 'op' || v.key === 'exec' ? { what: v.key, h: v.h } : { what: 'value', h: v.h, stage: v.stage, key: v.key });

  /* opt: { hour0 (test hour shown as tool hour 0), markets: [[name, product]], checks, kind }
   * returns [{ text, links, checks, first }] per line; checks are the indexes into opt.checks the line's assert matches,
   * first marks the first line of a statement (lines of one statement share their links). */
  function annotate(code, opt) {
    const lines = code.replace(/\r\n?/g, '\n').split('\n');
    const n = Math.max(1, opt.markets.length), h0 = opt.hour0 || 0, checks = opt.checks || [], hours = opt.hours || 1;
    const out = lines.map(text => ({ text, links: [], checks: [] }));
    const vars = {};
    let hour = 0, writes = 0, bidHour = 0, strategy = '';
    const H = () => hour - h0;
    const stage = () => (writes === 0 ? 's' : writes >= n ? 'e' : writes);
    const sameStage = (a, b) => a === b || ((a === 'e' || a === 'h') && (b === 'e' || b === 'h'));
    function findCheck(ref, expected) {
      let best = null;
      checks.forEach((c, i) => {
        if (c[0] !== ref.h || c[2] !== ref.key) return;
        const offer = ref.key.startsWith('offer') || ref.key === 'op' || ref.key === 'exec' || ref.key === 'socEnd';
        if (!offer && !sameStage(c[1], ref.stage)) return;
        const a = ref.key.startsWith('offer') ? Math.abs : x => x;  // negative reserve bids are stored negative
        if (expected != null && Math.abs(a(c[3]) - a(expected)) > Math.max(c[5] || 0, 1e-6)) return;
        if (best == null) best = i;
      });
      return best;
    }

    for (const st of statements(lines)) {
      const t = st.text, links = [];
      let m, found = [], wrote = false;
      if ((m = t.match(/^\s*start\s*=\s*datetime\(([^)]*)\)/))) {
        const a = m[1].split(',').map(s => parseInt(s, 10));
        hour = Number.isFinite(a[3]) ? a[3] : 0; writes = 0; bidHour = hour;
        links.push({ what: 'hour', h: H() });
      } else if ((m = t.match(/^\s*start\s*(?:=\s*start\s*\+|\+=)\s*(?:(?:pd\.)?timedelta\(hours=(\d+)\))?/i))) {
        hour += m[1] ? +m[1] : 1; writes = 0; bidHour = hour;
        links.push({ what: 'hour', h: H() });
      }
      if ((m = t.match(/product_tuples\s*=\s*\[\s*\(\s*start(?:\s*\+\s*pd\.Timedelta\(hours=(\d+)\))?/))) bidHour = hour + (m[1] ? +m[1] : 0);
      if ((m = t.match(/(\w+Strategy)\(\)/)) && /^\s*strategy\s*=/.test(t)) strategy = m[1];
      if ((m = t.match(UNIT_ATTRS))) links.push({ what: 'unit', attr: m[1] });
      if (/\.forecaster\s*=|availability=\[/.test(t)) links.push({ what: 'unit', attr: 'availability' });

      // writes to unit.outputs
      const wre = /outputs\["(energy|capacity_pos|capacity_neg|soc)"\]((?:\.loc|\.at)?\[[^\]]*\])\s*(\+=|-=|=(?!=))/g;
      while ((m = wre.exec(t))) {
        if (/^\.loc\[\s*index\s*\]$/.test(m[2])) { for (let h = 0; h < hours; h++) links.push({ what: 'band', h, product: m[1] }); continue; }
        const off = offsetOf(m[2]);
        if (m[1] === 'soc') links.push({ what: 'soc', h: H() + off });
        else { links.push({ what: 'band', h: H() + off, product: m[1] }); if (off === 0) wrote = true; }
      }
      if (/\.set_dispatch_plan\(/.test(t)) { links.push({ what: 'band', h: H(), product: 'energy' }); wrote = true; }

      // results of ASSUME calls
      const call = t.match(/^\s*([\w\s,]+?)\s*=\s*[\w.]+\.(calculate_min_max_discharge|calculate_min_max_charge|calculate_min_max_power|calculate_ramp_discharge|calculate_ramp_charge|calculate_ramp|get_operation_time|execute_current_dispatch)\(/);
      if (call) {
        const names = call[1].split(',').map(s => s.trim());
        let keys = CALL_KEYS[call[2]];
        if (call[2] === 'calculate_ramp') keys = [/min/.test(names[0]) ? 'rampMin' : 'rampMax'];
        const sg = call[2] === 'get_operation_time' || call[2] === 'execute_current_dispatch' ? 'h' : stage();
        names.forEach((nm, i) => { if (keys[i]) { vars[nm] = { h: H(), stage: sg, key: keys[i] }; links.push(valueLink(vars[nm])); } });
        if (/ramp/.test(call[2])) links.push({ what: 'prev', h: H() });
      } else if (/\.execute_current_dispatch\(/.test(t)) links.push({ what: 'exec', h: H() });
      if (/^\s*bids\s*=\s*\w+\.calculate_bids\(/.test(t)) {
        vars.bids = { h: bidHour - h0, plantEnergy: strategy === 'EnergyHeuristicFlexableStrategy' };
        if (vars.bids.plantEnergy) links.push({ what: 'value', h: vars.bids.h, stage: 's', key: 'inflex' }, { what: 'value', h: vars.bids.h, stage: 's', key: 'flex' });
        else links.push({ what: 'offer', h: vars.bids.h, n: 0 });
      }

      // asserts
      if ((m = t.match(/^\s*assert\s+(.*)$/))) {
        const body = m[1];
        let ref = null, expected = null, b;
        const lit = body.match(/(?:==|,)\s*(-?\d+(?:\.\d+)?)\s*(?:[,)]|$)/);
        if (lit) expected = +lit[1];
        if ((b = body.match(/bids\[(\d+)\]\["volume"\]/)) && vars.bids) {
          const key = vars.bids.plantEnergy ? (b[1] === '0' ? 'inflex' : 'flex') : 'offer0';
          ref = { h: vars.bids.h, stage: 's', key };
        } else if (/^bids\s*==\s*\[\]/.test(body) && vars.bids) { ref = { h: vars.bids.h, stage: 'h', key: 'offer0' }; expected = 0; }
        else if (/outputs\["soc"\](?:\.at)?\[\s*end\s*\]/.test(body)) { ref = { h: H(), stage: 'h', key: 'socEnd' }; links.push({ what: 'soc', h: H() + 1 }); }
        else if ((b = body.match(/^(?:math\.isclose\(\s*)?(\w+)(?:\[0\])?\s*(?:==|,)/)) && vars[b[1]] && vars[b[1]].key) ref = vars[b[1]];
        else if ((b = body.match(/outputs\["energy"\]\.loc\[\s*index\[(\d+)\]\s*:\s*index\[(\d+)\]\s*\]/))) {
          // a whole schedule after execute_current_dispatch
          const list = (body.match(/==\s*\[([^\]]*)\]/) || [])[1];
          const vals = list ? list.split(',').map(x => parseFloat(x)) : [];
          for (let h = +b[1] - h0; h <= +b[2] - h0; h++) {
            links.push({ what: 'exec', h });
            const v = vals[h - (+b[1] - h0)];
            const c = findCheck({ h, stage: 'h', key: 'exec' }, Number.isFinite(v) ? v : null);
            if (c != null) found.push(c);
          }
        } else if (/outputs\["energy"\]/.test(body)) links.push({ what: 'band', h: H(), product: 'energy' });
        if (ref) {
          if (ref.key.startsWith('offer')) links.push({ what: 'offer', h: ref.h, n: 0 });
          else if (ref.key !== 'socEnd') links.push(valueLink(ref));
          const c = findCheck(ref, expected);
          if (c != null) found.push(c);
        }
      }
      if (wrote) writes++;
      for (let i = st.from; i <= st.to; i++) Object.assign(out[i], { links, checks: found, first: i === st.from });
    }
    return out;
  }

  // ---------------------------------------------------------------- writing a test
  const NUM = /^-?\d+(\.\d+)?$/;
  function py(v) {
    if (v == null || v === '') return 'None';
    if (Number.isInteger(v)) return String(v);
    const r = Math.round(v * 1e6) / 1e6;
    return Object.is(r, -0) ? '0' : String(r);
  }
  const pyParam = v => (v === '' || v == null || !NUM.test(String(v).trim()) ? 'None' : py(+v));
  // pytest assert for a float, exact only when the tool computed an exact integer
  const assertEq = (expr, v) => (Number.isInteger(v) ? [`assert ${expr} == ${v}`] : [`assert math.isclose(${expr}, ${py(v)}, abs_tol=1e-3)`]);

  function stamp(t, freq) {
    const d = new Date(Date.UTC(2022, 0, 1) + Math.round(t * freq * 3600000));
    const parts = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours()];
    if (d.getUTCMinutes()) parts.push(d.getUTCMinutes());
    return `datetime(${parts.join(', ')})`;
  }
  const label = (t, freq) => { const m = Math.round(t * freq * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  /* sc: { unit, opts, markets:[{id,name,product}], steps }; sim: model.simulate(sc)
   * o:  { name, before, after, ramp, op, soc, exec } which asserts to write
   * returns { code, lines: [{ text, links }] } */
  function generate(sc, kind, sim, o) {
    const sto = kind === 'storage', freq = parseFloat(sc.opts.freq_h) || 1;
    const u = sto ? 'storage' : 'power_plant';
    const lines = [];
    const L = (text, ...links) => lines.push({ text, links });
    const call = (pad, lhs, fn, args, ...links) => {
      const head = `${pad}${lhs ? lhs + ' = ' : ''}${u}.${fn}(`;
      if ((head + args + ')').length <= 88) L(`${head}${args})`, ...links);
      else if (`${pad}    ${args}`.length <= 88) { L(head, ...links); L(`${pad}    ${args}`, ...links); L(`${pad})`, ...links); }
      else { L(head, ...links); args.split(', ').forEach(a => L(`${pad}    ${a},`, ...links)); L(`${pad})`, ...links); }
    };
    const n = sim.length;
    const freqStr = freq === 1 ? 'h' : `${Math.round(freq * 60)}min`;
    // orders are written to unit.outputs directly, as the ASSUME capacity tests do; without
    // execute_current_dispatch a storage needs set_dispatch_plan to move its soc to the next hour
    const carry = sto && !sc.opts.execute;

    L('import math');
    L('from datetime import datetime');
    L('');
    L('import pandas as pd');
    L('');
    L(`from assume.common.forecaster import ${sto ? 'UnitForecaster' : 'PowerplantForecaster'}`);
    if (carry) L('from assume.common.market_objects import MarketConfig');
    L(`from assume.units import ${sto ? 'Storage' : 'PowerPlant'}`);
    L('');
    L('');
    if (carry) {
      L('def carry_soc(storage, start, end):');
      L('    """Sets the soc of the next hour from this hour\'s energy, as');
      L('    Storage.set_dispatch_plan does after a market result (here for 0 MW)."""');
      L('    market = MarketConfig(market_id="EOM", product_type="energy")');
      L('    order = {');
      L('        "start_time": start,');
      L('        "end_time": end,');
      L('        "only_hours": None,');
      L('        "price": 0,');
      L('        "accepted_price": 0,');
      L('        "accepted_volume": 0,');
      L('    }');
      L('    storage.set_dispatch_plan(market, [order])');
      L('');
      L('');
    }
    L(`def ${o.name}():`);
    const mk = sc.markets.map(m => `${m.name} (${m.product})`).join(', ').replace(/"/g, "'") || 'no markets';
    L(`    """${n} hour${n === 1 ? '' : 's'}, markets ${mk}. Values from the Unit Headroom Tracker."""`);
    L(`    index = pd.date_range("2022-01-01", periods=${Math.max(n + 1, 3)}, freq="${freqStr}")`);
    if (sto) L('    forecaster = UnitForecaster(index, availability=1, market_prices={"EOM": 50})');
    else {
      const av = sc.steps.map(s => py(parseFloat(s.availability) >= 0 ? +s.availability : 1)).concat('1');
      L('    forecaster = PowerplantForecaster(', { what: 'unit', attr: 'availability' });
      L('        index,', { what: 'unit', attr: 'availability' });
      L(`        availability=[${av.join(', ')}],`, { what: 'unit', attr: 'availability' });
      L('        fuel_prices={"lignite": 10, "co2": 10},');
      L('        market_prices={"EOM": 0},');
      L('    )');
    }
    L(`    ${u} = ${sto ? 'Storage' : 'PowerPlant'}(`);
    L(`        id="test_${sto ? 'storage' : 'pp'}",`);
    L('        unit_operator="test_operator",');
    L(`        technology="${sto ? 'battery' : 'hard coal'}",`);
    L('        bidding_strategies={},');
    L('        forecaster=forecaster,');
    if (!sto) { L('        index=forecaster.index,'); L('        efficiency=0.5,'); L('        additional_cost=10,'); L('        fuel_type="lignite",'); L('        emission_factor=0.5,'); }
    const params = sto
      ? ['max_power_charge', 'max_power_discharge', 'min_power_charge', 'min_power_discharge', 'capacity', 'initial_soc', 'min_soc', 'max_soc',
        'efficiency_charge', 'efficiency_discharge', 'ramp_up_charge', 'ramp_down_charge', 'ramp_up_discharge', 'ramp_down_discharge']
      : ['max_power', 'min_power', 'ramp_up', 'ramp_down', 'min_operating_time', 'min_down_time'];
    for (const p of params) {
      let v = pyParam(sc.unit[p]);
      if (v === 'None' && !/ramp/.test(p)) v = '0';
      L(`        ${p}=${v},`, { what: 'unit', attr: p });
    }
    L('    )');

    const p0 = parseFloat(sc.opts.initial_previous_power) || 0;
    sim.forEach((r, t) => {
      const hl = { what: 'hour', h: t };
      L('');
      L(`    # ---- ${label(t, freq)}`, hl);
      L(`    start = ${stamp(t, freq)}`, hl);
      L(`    end = ${stamp(t + 1, freq)}`, hl);
      const wantRamp = o.ramp, orders = r.stages.filter(st => st.offer != null);
      if (wantRamp || (o.op && !sto)) {
        if (t === 0 && p0) L(`    previous_power = ${py(p0)}  # previous_power before the first hour, set in the tool`, { what: 'prev', h: t });
        else if (wantRamp) L(`    previous_power = ${u}.get_output_before(start)`, { what: 'prev', h: t });
      }
      if (sto && wantRamp) L(`    soc = ${u}.outputs["soc"].at[start]`, { what: 'soc', h: t });
      if (!sto && (wantRamp || o.op)) {
        L(`    op_time = ${u}.get_operation_time(start)`, { what: 'op', h: t });
        if (o.op) L(`    assert op_time == ${r.op}`, { what: 'op', h: t });
      }

      const checkpoint = (stg, w, title) => {
        const v = key => ({ what: 'value', h: t, stage: stg, key });
        L(`    # ${title}`, v(sto ? 'disMax' : 'max'), v(sto ? 'disMin' : 'min'));
        if (sto) {
          call('    ', 'min_power_discharge, max_power_discharge', 'calculate_min_max_discharge', 'start, end', v('disMin'), v('disMax'));
          assertEq('min_power_discharge[0]', w.disMin).forEach(s => L(`    ${s}`, v('disMin')));
          assertEq('max_power_discharge[0]', w.disMax).forEach(s => L(`    ${s}`, v('disMax')));
          call('    ', 'min_power_charge, max_power_charge', 'calculate_min_max_charge', 'start, end', v('chMin'), v('chMax'));
          assertEq('min_power_charge[0]', w.chMin).forEach(s => L(`    ${s}`, v('chMin')));
          assertEq('max_power_charge[0]', w.chMax).forEach(s => L(`    ${s}`, v('chMax')));
          if (wantRamp) {
            L(`    current_power = ${u}.outputs["energy"].at[start]`, { what: 'band', h: t, product: 'energy' });
            call('    ', 'max_ramp_discharge', 'calculate_ramp_discharge', 'soc, previous_power, max_power_discharge[0], current_power, min_power_discharge[0]', v('rampDis'), { what: 'prev', h: t });
            assertEq('max_ramp_discharge', w.rampDis).forEach(s => L(`    ${s}`, v('rampDis')));
            call('    ', 'max_ramp_charge', 'calculate_ramp_charge', 'soc, previous_power, max_power_charge[0], current_power, min_power_charge[0]', v('rampCh'), { what: 'prev', h: t });
            assertEq('max_ramp_charge', w.rampCh).forEach(s => L(`    ${s}`, v('rampCh')));
          }
        } else {
          call('    ', 'min_power, max_power', 'calculate_min_max_power', 'start, end, product_type="energy"', v('min'), v('max'));
          assertEq('min_power[0]', w.min).forEach(s => L(`    ${s}`, v('min')));
          assertEq('max_power[0]', w.max).forEach(s => L(`    ${s}`, v('max')));
          if (wantRamp) {
            L(`    current_power = ${u}.outputs["energy"].at[start]`, { what: 'band', h: t, product: 'energy' });
            call('    ', 'min_ramp', 'calculate_ramp', 'op_time, previous_power, min_power[0], current_power', v('rampMin'), { what: 'prev', h: t });
            call('    ', 'max_ramp', 'calculate_ramp', 'op_time, previous_power, max_power[0], current_power', v('rampMax'), { what: 'prev', h: t });
            assertEq('min_ramp', w.rampMin).forEach(s => L(`    ${s}`, v('rampMin')));
            assertEq('max_ramp', w.rampMax).forEach(s => L(`    ${s}`, v('rampMax')));
          }
        }
      };

      if (!orders.length && (o.before || o.after)) checkpoint('s', r.start, 'nothing is offered this hour');
      r.stages.forEach((st, j) => {
        if (st.offer == null) return;
        if (o.before) checkpoint(j === 0 ? 's' : j, st.win, `before ${st.m.name} (${st.m.product})`);
        const vol = py(st.offer), how = st.auto ? ` (max → ${vol})` : '';
        if (st.on) L(`    ${u}.outputs["${st.m.product}"][start] += ${vol}  # ${st.m.name} accepts ${vol} MW${how}`, { what: 'band', h: t, product: st.m.product });
        else L(`    # ${st.m.name}: the order of ${vol} MW${how} is not accepted`, { what: 'offer', h: t, n: j });
      });
      if (o.after && orders.length) checkpoint('e', r.end, 'after all orders of this hour');

      if (sc.opts.execute) {
        L(`    dispatched = ${u}.execute_current_dispatch(start, start)  # end is inclusive`, { what: 'exec', h: t });
        if (o.exec) assertEq('dispatched[0]', r.exec).forEach(s => L(`    ${s}`, { what: 'exec', h: t }));
      } else if (carry) L(`    carry_soc(${u}, start, end)`, { what: 'soc', h: t + 1 });
      if (sto && o.soc) assertEq(`${u}.outputs["soc"].at[end]`, r.socEnd).forEach(s => L(`    ${s}`, { what: 'soc', h: t + 1 }));
    });
    return { code: lines.map(l => l.text).join('\n') + '\n', lines };
  }

  // ---------------------------------------------------------------- highlighting
  const KW = new Set(['def', 'return', 'assert', 'import', 'from', 'as', 'for', 'in', 'if', 'elif', 'else', 'with', 'class', 'lambda',
    'and', 'or', 'not', 'is', 'None', 'True', 'False', 'raise', 'try', 'except', 'while', 'pass', 'yield', 'async', 'await']);
  const TOKEN = /(#.*$)|([rbuf]{0,2}"""[^]*?"""|[rbuf]{0,2}"(?:\\.|[^"\\])*"|[rbuf]{0,2}'(?:\\.|[^'\\])*')|(@\w+(?:\.\w+)*)|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_]\w*)/g;
  // [[cls, text]] with cls '' for plain text
  function tokens(line) {
    const out = [];
    let last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(line))) {
      if (m.index > last) out.push(['', line.slice(last, m.index)]);
      const cls = m[1] ? 'cm' : m[2] ? 'st' : m[3] ? 'dc' : m[4] ? 'nu' : KW.has(m[5]) ? 'kw' : /^(self|math|pd|np)$/.test(m[5]) ? 'bi' : line[TOKEN.lastIndex] === '(' ? 'fn' : '';
      out.push([cls, m[0]]);
      last = TOKEN.lastIndex;
    }
    if (last < line.length) out.push(['', line.slice(last)]);
    return out;
  }

  const api = { annotate, generate, tokens, statements };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UHTTestCode = api;
})(typeof window !== 'undefined' ? window : this);

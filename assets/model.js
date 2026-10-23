/* ASSUME unit arithmetic, ported line by line from assume-framework/assume @ c325fdd:
 *   assume/units/storage.py      calculate_min_max_charge/discharge, calculate_soc_max_*, ramp overrides, execute_current_dispatch
 *   assume/units/powerplant.py   calculate_min_max_power, execute_current_dispatch
 *   assume/common/base.py        calculate_ramp, calculate_ramp_charge/discharge, get_operation_time, set_dispatch_plan
 * plus the volume rules of the flexable strategies. Pure functions, no DOM, so it runs in Node too. */
(function (root) {
  'use strict';
  const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const optNum = v => (v === '' || v == null || !Number.isFinite(parseFloat(v)) ? null : parseFloat(v));

  // ---------------------------------------------------------------- storage
  function storageUnit(u, freq_h) {
    return {
      max_power_charge: num(u.max_power_charge), max_power_discharge: num(u.max_power_discharge),
      min_power_charge: num(u.min_power_charge), min_power_discharge: num(u.min_power_discharge),
      capacity: num(u.capacity), min_soc: num(u.min_soc), max_soc: num(u.max_soc, 1),
      efficiency_charge: num(u.efficiency_charge, 1) || 1, efficiency_discharge: num(u.efficiency_discharge, 1) || 1,
      ramp_up_charge: optNum(u.ramp_up_charge), ramp_down_charge: optNum(u.ramp_down_charge),
      ramp_up_discharge: optNum(u.ramp_up_discharge), ramp_down_discharge: optNum(u.ramp_down_discharge),
      dt: num(freq_h, 1) || 1,
    };
  }
  const socMaxDischarge = (u, soc) => Math.max(0, (soc - u.min_soc) * u.capacity * u.efficiency_discharge / u.dt);
  const socMaxCharge = (u, soc) => Math.min(0, (soc - u.max_soc) * u.capacity / u.efficiency_charge / u.dt);

  function minMaxCharge(u, o, soc) {
    const raw_min = u.min_power_charge - (o.energy + o.capacity_pos);
    let min = Math.min(raw_min, 0);
    const raw_max = u.max_power_charge - (o.energy + o.capacity_neg);
    let max = raw_max <= min ? raw_max : 0;
    const maxZeroed = !(raw_max <= min);
    const minBefore = min;
    min = min >= max ? min : 0;
    const socLim = socMaxCharge(u, soc);
    const beforeSoc = max;
    max = Math.max(max, socLim);
    return { min, max, raw_min, raw_max, maxZeroed, minZeroed: minBefore !== min, socLim, socBinding: max !== beforeSoc };
  }
  function minMaxDischarge(u, o, soc) {
    const raw_min = u.min_power_discharge - (o.energy + o.capacity_neg);
    let min = Math.max(raw_min, 0);
    const raw_max = u.max_power_discharge - (o.energy + o.capacity_pos);
    let max = raw_max >= min ? raw_max : 0;
    const maxZeroed = !(raw_max >= min);
    const minBefore = min;
    min = min < max ? min : 0;
    const socLim = socMaxDischarge(u, soc);
    const beforeSoc = max;
    max = Math.min(max, socLim);
    return { min, max, raw_min, raw_max, maxZeroed, minZeroed: minBefore !== min, socLim, socBinding: max !== beforeSoc };
  }
  /* SupportsMinMaxCharge.calculate_ramp_discharge checks self.calculate_ramp_charge(previous_power, 0, current_power),
   * but Storage overrides that method with soc as its first argument, so ASSUME really runs
   * Storage.calculate_ramp_charge(soc=previous_power, previous_power=0, power_charge=current_power).
   * The shifted call is kept here so the results match ASSUME (likewise in baseRampCharge). */
  function baseRampDischarge(u, prev, p, cur) {
    if (prev < 0) { const back = rampCharge(u, prev, 0, cur, 0); if (back < 0) return back; }
    prev = Math.max(prev, 0);
    p = Math.min(p, u.max_power_discharge - cur);
    if (u.ramp_up_discharge != null) p = Math.min(p, Math.max(prev + u.ramp_up_discharge - cur, 0));
    if (u.ramp_down_discharge != null && p !== 0) p = Math.max(p, prev - u.ramp_down_discharge - cur, 0);
    return p;
  }
  function baseRampCharge(u, prev, p, cur) {
    if (prev > 0) { const back = rampDischarge(u, prev, 0, cur, 0); if (back > 0) return back; }
    prev = Math.min(prev, 0);
    p = Math.max(p, u.max_power_charge - cur);
    if (u.ramp_up_charge != null) p = Math.max(p, Math.min(prev + u.ramp_up_charge - cur, 0));
    if (u.ramp_down_charge != null && p !== 0) p = Math.min(p, prev - u.ramp_down_charge - cur, 0);
    return p;
  }
  function rampDischarge(u, soc, prev, p, cur, minP = 0) {
    let v = Math.min(baseRampDischarge(u, prev, p, cur), socMaxDischarge(u, soc));
    if (v < minP) v = 0;
    return v;
  }
  function rampCharge(u, soc, prev, p, cur, minP = 0) {
    let v = Math.max(baseRampCharge(u, prev, p, cur), socMaxCharge(u, soc));
    if (v > minP) v = 0;
    return v;
  }
  // set_dispatch_plan: clip to SOC only. execute_current_dispatch: power limits, min power, then SOC.
  function storageSetDispatch(u, soc, p) {
    if (p > 0) return Math.min(p, socMaxDischarge(u, soc));
    if (p < 0) return Math.max(p, socMaxCharge(u, soc));
    return 0;
  }
  function storageExecute(u, soc, p) {
    if (p > u.max_power_discharge) p = u.max_power_discharge;
    else if (p < u.max_power_charge) p = u.max_power_charge;
    else if (u.min_power_discharge > p && p > u.min_power_charge && p !== 0) p = 0;
    return storageSetDispatch(u, soc, p);
  }
  function deltaSoc(u, p) {
    if (p > 0) return -p * u.dt / u.efficiency_discharge / u.capacity;
    if (p < 0) return -p * u.dt * u.efficiency_charge / u.capacity;
    return 0;
  }

  // ---------------------------------------------------------------- power plant
  function plantUnit(u) {
    return {
      max_power: num(u.max_power), min_power: num(u.min_power),
      ramp_up: optNum(u.ramp_up), ramp_down: optNum(u.ramp_down),
      min_operating_time: Math.max(0, Math.round(num(u.min_operating_time))), min_down_time: Math.max(0, Math.round(num(u.min_down_time))),
    };
  }
  function minMaxPower(u, o, availability) {
    const available = availability * u.max_power;
    const raw_max = available - o.capacity_pos - o.energy;
    let max = Math.max(raw_max, 0);
    const raw_min = u.min_power + o.capacity_neg - o.energy;
    // min_power.clip(min=heat_demand_still_needed); heat demand is not modelled, so this clips at 0
    let min = Math.max(raw_min, 0);
    const infeasible = max < min;
    if (infeasible) { min = 0; max = 0; }
    return { min, max, raw_min, raw_max, available, infeasible };
  }
  function calculateRamp(u, op, prev, power, cur = 0) {
    if (u.ramp_down == null && u.ramp_up == null) return power;
    if (power > 0 && op < 0 && op > -u.min_down_time) power = 0;
    else if (power === 0 && op > 0 && op < u.min_operating_time) power = u.min_power;
    if (power === 0) return power;
    if (u.ramp_up != null) power = Math.min(power, prev + u.ramp_up - cur, u.max_power - cur);
    if (u.ramp_down != null) power = Math.max(power, prev - u.ramp_down - cur, u.min_power - cur);
    return power;
  }
  // get_operation_time on an energy history (hist[i] for hours before t)
  function operationTime(u, hist, t) {
    const maxTime = Math.max(u.min_operating_time, u.min_down_time, 1);
    if (t <= 0) return maxTime;
    const begin = Math.max(t - maxTime, 0);
    const arr = hist.slice(begin, t).map(v => v > 0).reverse();
    const isOff = arr.length ? !arr[0] : false;
    let run = 0;
    for (const v of arr) { if (v !== !isOff) break; run++; }
    return isOff ? -run : run;
  }
  function plantExecute(u, op, prev, p, availability) {
    p = calculateRamp(u, op, prev, p);
    if (p > 0) { p = Math.min(p, availability * u.max_power); p = Math.max(p, u.min_power); }
    return p;
  }

  // ---------------------------------------------------------------- scenario simulation
  const EPS = 1e-9;
  const emptyOutputs = () => ({ energy: 0, capacity_pos: 0, capacity_neg: 0, E: [], RU: [], RD: [] });

  function windows(ctx, o) {
    if (ctx.kind === 'storage') {
      const { u, soc, prev } = ctx;
      const dis = minMaxDischarge(u, o, soc), ch = minMaxCharge(u, o, soc);
      return {
        dis, ch, disMin: dis.min, disMax: dis.max, chMin: ch.min, chMax: ch.max,
        rampDis: rampDischarge(u, soc, prev, dis.max, o.energy, dis.min),
        rampCh: rampCharge(u, soc, prev, ch.max, o.energy, ch.min),
      };
    }
    const { u, op, prev, availability } = ctx;
    const pw = minMaxPower(u, o, availability);
    const rampMax = calculateRamp(u, op, prev, pw.max, o.energy), rampMin = calculateRamp(u, op, prev, pw.min, o.energy);
    return { pw, min: pw.min, max: pw.max, rampMin, rampMax, inflex: rampMin, flex: rampMax - rampMin };
  }
  // What 'max' / '-max' resolves to, following the flexable strategies
  function resolveMax(ctx, win, product, negative) {
    if (ctx.kind === 'storage') {
      if (product === 'energy') return negative ? win.rampCh : win.rampDis;
      if (product === 'capacity_pos') return win.rampDis;
      return win.rampCh;
    }
    if (product === 'energy') return negative ? win.rampMin : win.rampMax;
    if (product === 'capacity_pos') return win.rampMax;
    return Math.max(ctx.prev - win.rampMin, 0);
  }
  function commit(o, m, v) {
    const t = { ...o, E: o.E.slice(), RU: o.RU.slice(), RD: o.RD.slice() };
    if (m.product === 'energy') { t.E.push({ m, from: t.energy, to: t.energy + v, v }); t.energy += v; }
    if (m.product === 'capacity_pos') { t.RU.push({ m, v }); t.capacity_pos += v; }
    if (m.product === 'capacity_neg') { t.RD.push({ m, v }); t.capacity_neg += v; }
    return t;
  }

  /* scenario: { kind, unit, opts:{initial_previous_power, execute, freq_h}, markets:[{id,name,product}],
   *             steps:[{bids:{[id]:{v,on}}, availability}] } */
  function simulate(sc) {
    const isSto = sc.kind === 'storage';
    const freq = num(sc.opts.freq_h, 1) || 1;
    const u = isSto ? storageUnit(sc.unit, freq) : plantUnit(sc.unit);
    const hist = [];
    let soc = isSto ? num(sc.unit.initial_soc, 0.5) : null;
    return sc.steps.map((step, t) => {
      const prev = t === 0 ? num(sc.opts.initial_previous_power) : hist[t - 1];
      let ctx;
      if (isSto) {
        const socDis = socMaxDischarge(u, soc), socCh = socMaxCharge(u, soc);
        const U = Math.min(u.max_power_discharge, socDis, baseRampDischarge(u, prev, u.max_power_discharge, 0));
        const L = Math.max(u.max_power_charge, socCh, baseRampCharge(u, prev, u.max_power_charge, 0));
        ctx = { kind: 'storage', u, soc, prev, socDis, socCh, U, L, yMin: Math.min(u.max_power_charge, 0), yMax: Math.max(u.max_power_discharge, 0) };
      } else {
        const availability = num(step.availability, 1);
        const op = operationTime(u, hist, t);
        const avail = availability * u.max_power;
        const U = Math.max(0, Math.min(avail, calculateRamp(u, op, prev, avail, 0)));
        const L = u.ramp_down != null ? Math.max(u.min_power, prev - u.ramp_down) : u.min_power;
        ctx = { kind: 'plant', u, op, prev, availability, avail, U, L, yMin: 0, yMax: Math.max(u.max_power, 1) };
      }
      let o = emptyOutputs();
      const stages = sc.markets.map(m => {
        const win = windows(ctx, o);
        const b = step.bids[m.id];
        const st = { m, win, bid: b, offer: null, acc: 0, auto: false, invalid: false, on: !!(b && b.on !== false) };
        const raw = b ? String(b.v ?? '').trim().toLowerCase().replace(/\s+/g, '').replace('−', '-') : '';
        if (raw !== '') {
          let offer;
          if (raw === 'max' || raw === '+max') { offer = resolveMax(ctx, win, m.product, false); st.auto = true; }
          else if (raw === '-max') { offer = resolveMax(ctx, win, m.product, true); st.auto = true; }
          else offer = parseFloat(raw);
          if (!Number.isFinite(offer)) { st.invalid = true; offer = 0; }
          st.offer = Math.round(offer * 1e9) / 1e9;
          st.acc = st.on ? st.offer : 0;
          if (Math.abs(st.acc) > EPS) o = commit(o, m, st.acc);
        }
        st.after = o;
        return st;
      });
      const end = windows(ctx, o);
      let exec, stored, socEnd = null;
      if (isSto) {
        exec = storageExecute(u, soc, o.energy);
        stored = sc.opts.execute ? exec : storageSetDispatch(u, soc, o.energy);
        socEnd = soc + deltaSoc(u, stored);
      } else {
        exec = plantExecute(u, ctx.op, prev, o.energy, ctx.availability);
        stored = sc.opts.execute ? exec : o.energy;
      }
      hist[t] = stored;
      const res = { t, ctx, o, stages, start: stages.length ? stages[0].win : end, end, exec, stored, soc, socEnd, prev, op: ctx.op };
      if (isSto) soc = socEnd;
      return res;
    });
  }

  // value for a check key at a given hour/stage
  function checkValue(r, stage, key) {
    if (key.startsWith('offer')) { const st = r.stages[+key.slice(5)]; return st && st.offer != null ? st.offer : 0; }
    if (key === 'exec') return r.exec;
    if (key === 'socEnd') return r.socEnd;
    if (key === 'op') return r.op;
    const w = stage === 's' ? r.start : stage === 'e' || stage === 'h' ? r.end : (r.stages[stage] ? r.stages[stage].win : r.end);
    return w[key];
  }

  const api = { num, optNum, storageUnit, plantUnit, socMaxDischarge, socMaxCharge, minMaxCharge, minMaxDischarge, baseRampDischarge,
    baseRampCharge, rampDischarge, rampCharge, storageExecute, storageSetDispatch, deltaSoc, minMaxPower, calculateRamp,
    operationTime, plantExecute, windows, simulate, checkValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UHTModel = api;
})(typeof window !== 'undefined' ? window : this);

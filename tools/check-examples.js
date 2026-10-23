// Runs every example in assets/examples.js through assets/model.js and compares with the ASSUME test asserts.
// Usage: node tools/check-examples.js
const path = require('path').resolve(__dirname, '..');
const M = require(path + '/assets/model.js');
global.window = {};
require(path + '/assets/examples.js');
const EX = window.ASSUME_EXAMPLES, FIX = window.ASSUME_FIXTURES;
let pass = 0, fail = 0;
for (const ex of EX) {
  const markets = ex.markets.map(([name, product], i) => ({ id: 'm' + i, name, product }));
  const steps = ex.bids.map((row, t) => ({ availability: ex.availability ? ex.availability[t] : 1,
    bids: Object.fromEntries(row.map((b, j) => [markets[j].id, b == null ? null : Array.isArray(b) ? { v: String(b[0]), on: b[1] } : { v: String(b), on: true }]).filter(([, b]) => b)) }));
  const sc = { kind: ex.kind, unit: { ...FIX[ex.kind], ...ex.unit }, opts: { initial_previous_power: 0, execute: false, freq_h: 1, ...(ex.opts || {}) }, markets, steps };
  const res = M.simulate(sc);
  for (const [h, stage, key, exp, label, tol] of ex.checks) {
    const v = M.checkValue(res[h], stage, key);
    const ok = Math.abs(v - exp) <= (tol ?? 1e-6);
    ok ? pass++ : fail++;
    if (!ok) console.log('FAIL', ex.id, h, stage, key, 'got', v, 'expected', exp, label);
  }
}
console.log(`${pass} asserts match, ${fail} differ`);
process.exit(fail ? 1 : 0);

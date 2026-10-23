/* Compares the ASSUME commit the tool was ported from (PINNED) with the current ASSUME main.
 * Splits the tracked Python files into functions and reports which tests, fixtures and ported
 * functions were changed, added or removed. Pure functions plus fetch, so it runs in Node too
 * (tools/check-upstream.js). After porting a newer ASSUME version, set PINNED to that commit. */
(function (root) {
  'use strict';
  const REPO = 'assume-framework/assume';
  const PINNED = 'c325fdd49a6e7cf75efaf3603afd050be356667c';
  const BRANCH = 'main';

  // Test files: every top-level function (tests and fixtures). Source files: the functions model.js ports.
  const TESTS = ['tests/test_storage.py', 'tests/test_powerplant.py', 'tests/test_flexable_strategies.py', 'tests/test_flexable_storage_strategies.py'];
  const SOURCES = {
    'assume/units/storage.py': ['Storage.execute_current_dispatch', 'Storage.calculate_soc_max_discharge', 'Storage.calculate_soc_max_charge',
      'Storage.calculate_min_max_charge', 'Storage.calculate_min_max_discharge', 'Storage.calculate_ramp_discharge', 'Storage.calculate_ramp_charge'],
    'assume/units/powerplant.py': ['PowerPlant.execute_current_dispatch', 'PowerPlant.calculate_min_max_power'],
    'assume/common/base.py': ['BaseUnit.set_dispatch_plan', 'SupportsMinMax.calculate_ramp', 'SupportsMinMax.get_operation_time',
      'SupportsMinMaxCharge.calculate_ramp_discharge', 'SupportsMinMaxCharge.calculate_ramp_charge', 'SupportsMinMaxCharge.set_dispatch_plan'],
    'assume/strategies/flexable.py': ['EnergyHeuristicFlexableStrategy.calculate_bids', 'CapacityHeuristicBalancingPosStrategy.calculate_bids',
      'CapacityHeuristicBalancingNegStrategy.calculate_bids'],
    'assume/strategies/flexable_storage.py': ['StorageEnergyHeuristicFlexableStrategy.calculate_bids', 'StorageCapacityHeuristicBalancingPosStrategy.calculate_bids',
      'StorageCapacityHeuristicBalancingNegStrategy.calculate_bids'],
  };

  const rawUrl = (sha, file) => `https://raw.githubusercontent.com/${REPO}/${sha}/${file}`;
  const blobUrl = (sha, file, line) => `https://github.com/${REPO}/blob/${sha}/${file}${line ? '#L' + line : ''}`;
  const indentOf = l => l.match(/^\s*/)[0].length;

  // { 'name' or 'Class.name': { code, line, kind } } for top-level functions, classes' methods and their decorators.
  function pyFunctions(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const out = {};
    let cls = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const ind = indentOf(l);
      if (ind === 0) cls = (l.match(/^class\s+(\w+)/) || [])[1] || null;
      const m = l.match(/^(\s*)(?:async\s+)?def\s+(\w+)/);
      if (!m || (ind > 0 && !(cls && ind === 4))) continue;
      let start = i;
      while (start > 0 && /^\s*@/.test(lines[start - 1]) && indentOf(lines[start - 1]) === ind) start--;
      let end = i + 1, last = i;
      for (; end < lines.length; end++) {
        const t = lines[end].trim();
        if (!t || t.startsWith('#')) continue;
        if (indentOf(lines[end]) <= ind && !/^[)\]}]/.test(t)) break;
        last = end;
      }
      const code = lines.slice(start, last + 1).map(s => s.trimEnd()).join('\n');
      const decorators = lines.slice(start, i).join('\n');
      const name = ind ? `${cls}.${m[2]}` : m[2];
      out[name] = { code, line: i + 1, kind: /pytest\.fixture/.test(decorators) ? 'fixture' : /^test_/.test(m[2]) ? 'test' : 'function' };
      i = last;
    }
    return out;
  }

  function diffFile(file, oldText, newText, only) {
    const a = oldText == null ? {} : pyFunctions(oldText), b = newText == null ? {} : pyFunctions(newText);
    const names = only || Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    const items = [];
    for (const name of names) {
      const o = a[name], n = b[name];
      const status = !o && !n ? null : !o ? 'added' : !n ? 'removed' : o.code !== n.code ? 'changed' : null;
      if (status) items.push({ file, name, status, kind: (n || o).kind, line: n ? n.line : o.line, oldLine: o ? o.line : null });
    }
    return items;
  }

  async function fetchText(fetchFn, url, headers) {
    const r = await fetchFn(url, { headers: headers || {} });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  }

  // Resolves BRANCH to a commit, then diffs every tracked file between PINNED and that commit.
  // opts.fetch: fetch implementation; opts.token: GitHub token (optional, raises the API rate limit).
  async function check(opts = {}) {
    const fetchFn = opts.fetch || root.fetch.bind(root);
    const api = { Accept: 'application/vnd.github+json' };
    if (opts.token) api.Authorization = `Bearer ${opts.token}`;
    const r = await fetchFn(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { headers: api });
    if (!r.ok) throw new Error(`GitHub API: HTTP ${r.status}`);
    const head = await r.json();
    const latest = { sha: head.sha, date: head.commit && head.commit.committer && head.commit.committer.date, url: head.html_url };
    const result = { repo: REPO, pinned: PINNED, latest, upToDate: head.sha === PINNED, tests: [], sources: [], missing: [] };
    if (result.upToDate) return result;
    const files = [...TESTS.map(f => [f, null, 'tests']), ...Object.entries(SOURCES).map(([f, fns]) => [f, fns, 'sources'])];
    await Promise.all(files.map(async ([file, only, bucket]) => {
      const [oldText, newText] = await Promise.all([fetchText(fetchFn, rawUrl(PINNED, file)), fetchText(fetchFn, rawUrl(head.sha, file))]);
      if (newText == null) result.missing.push(file);
      result[bucket].push(...diffFile(file, oldText, newText, only));
    }));
    const order = f => [...TESTS, ...Object.keys(SOURCES)].indexOf(f);
    for (const k of ['tests', 'sources']) result[k].sort((x, y) => order(x.file) - order(y.file) || x.line - y.line);
    return result;
  }

  // Marks test items that have an example in examples.js (matched by file and the test name before ' · ').
  function markPorted(result, examples) {
    const ported = new Set(examples.map(e => e.file + '::' + e.test.split(' · ')[0]));
    for (const t of result.tests) t.ported = ported.has(t.file + '::' + t.name);
    return result;
  }

  const api = { REPO, PINNED, BRANCH, TESTS, SOURCES, rawUrl, blobUrl, pyFunctions, diffFile, check, markPorted };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UHTUpstream = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Checks whether ASSUME main changed the tests or functions this tool is ported from (see assets/upstream.js).
// Usage: node tools/check-upstream.js [--out report.md]
// Prints a Markdown report. In GitHub Actions it also sets the outputs changed=true|false and latest=<sha>.
// Set GITHUB_TOKEN to raise the GitHub API rate limit.
const fs = require('fs');
const path = require('path').resolve(__dirname, '..');
const U = require(path + '/assets/upstream.js');
global.window = {};
require(path + '/assets/examples.js');

const short = sha => sha.slice(0, 7);
const STATUS = { changed: 'changed', added: 'new', removed: 'removed' };

function report(r) {
  const head = `ASSUME [\`${short(r.latest.sha)}\`](${r.latest.url}) on \`${U.BRANCH}\` (${(r.latest.date || '').slice(0, 10)}), `
    + `tool pinned to [\`${short(r.pinned)}\`](https://github.com/${r.repo}/tree/${r.pinned}).`;
  if (r.upToDate) return `${head}\n\nThe tool is up to date.\n`;
  const relevant = r.tests.length + r.sources.length + r.missing.length;
  let md = `${head}\n\n[Compare ${short(r.pinned)}...${short(r.latest.sha)}](https://github.com/${r.repo}/compare/${r.pinned}...${r.latest.sha})\n\n`;
  if (!relevant) return md + 'ASSUME has newer commits, but none of them touch the tracked tests or ported functions. Setting `PINNED` in `assets/upstream.js` to the new commit is enough.\n';
  const row = i => {
    const link = i.status === 'removed' ? U.blobUrl(r.pinned, i.file, i.oldLine) : U.blobUrl(r.latest.sha, i.file, i.line);
    const port = i.kind !== 'test' ? '' : i.ported ? 'has an example' : 'no example';
    return `| [\`${i.name}\`](${link}) | ${i.kind} | ${STATUS[i.status]} | ${port} |`;
  };
  const table = items => '| Function | Kind | Status | In the tool |\n|---|---|---|---|\n' + items.map(row).join('\n') + '\n';
  if (r.missing.length) md += `### Files no longer on ${U.BRANCH}\n\n` + r.missing.map(f => `- \`${f}\``).join('\n') + '\n\n';
  if (r.tests.length) md += '### Tests and fixtures\n\n' + table(r.tests) + '\n';
  if (r.sources.length) md += '### Functions ported in `assets/model.js`\n\n' + table(r.sources) + '\n';
  md += '### To update the tool\n\n'
    + '1. Port the changed functions into `assets/model.js`.\n'
    + '2. Update or add the examples in `assets/examples.js` for the changed and new tests, then run `node tools/check-examples.js`.\n'
    + `3. Set \`PINNED\` in \`assets/upstream.js\` to \`${r.latest.sha}\`.\n`;
  return md;
}

(async () => {
  const r = U.markPorted(await U.check({ fetch, token: process.env.GITHUB_TOKEN }), window.ASSUME_EXAMPLES);
  const md = report(r);
  const i = process.argv.indexOf('--out');
  if (i > 0) fs.writeFileSync(process.argv[i + 1], md);
  console.log(md);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${!r.upToDate}\nlatest=${r.latest.sha}\n`);
})().catch(e => { console.error(e.message); process.exit(1); });

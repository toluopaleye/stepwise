// Reads a JSON array of jobs from stdin, runs each with PyRun, prints JSON results.
// job: {id, src}  -> {id, stdout, error: {type, message} | null}
// job: {id, src, tests: [{code, expect}]} -> {id, load, results}
const path = require('path');
const PyRun = require(path.join(__dirname, '..', 'dist', 'pyrun.js'));
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const jobs = JSON.parse(input);
  const out = [];
  for (const job of jobs) {
    try {
      if (job.tests) {
        const r = PyRun.runTests(job.src, job.tests, { pre: job.pre });
        out.push({
          id: job.id,
          load: { ok: r.load.ok, stdout: r.load.stdout, error: r.load.error ? { type: r.load.error.type, message: r.load.error.message, line: r.load.error.line } : null },
          results: r.results.map((x) => ({ ok: x.ok, got: x.gotRepr, stdout: x.stdout, error: x.error ? { type: x.error.type, message: x.error.message } : null })),
        });
      } else {
        const r = PyRun.run(job.src, { stepLimit: job.stepLimit || 20000000, filename: 'main.py' });
        out.push({ id: job.id, stdout: r.stdout, error: r.error ? { type: r.error.type, message: r.error.message, line: r.error.line, internal: !!r.error.internal } : null });
      }
    } catch (e) {
      out.push({ id: job.id, crash: String(e && e.stack || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});

/** Normalize app results for an independently implemented Python oracle.
 * This file never creates expected answers and contains no interval arithmetic.
 */
import fs from 'node:fs';
import {analyze, emptyDecisions, exportBundle} from '../src/core.mjs';

function timestamp(ms) {
  const date = new Date(ms);
  // Keep source construction independent of app's stamp() implementation.
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  return `${hours}:${String(date.getUTCMinutes()).padStart(2,'0')}:${String(date.getUTCSeconds()).padStart(2,'0')},${String(date.getUTCMilliseconds()).padStart(3,'0')}`;
}
function sourceSrt(cues) {
  return cues.map((c, i) => `${(i + 1) * 7}\n${timestamp(c.startMs)} --> ${timestamp(c.endMs)}\n${c.text}\n`).join('\n');
}
function normalizeDecision(decision) {
  return decision.action === 'keep'
    ? {action: 'fragment', fragmentIndex: decision.fragment, text: decision.text}
    : decision;
}

const input = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
const cases = JSON.parse(input);
const results = [];
for (const testCase of cases) {
  const map = {version: 1, keep: testCase.keep.map(([startMs,endMs]) => ({startMs,endMs}))};
  const plan = await analyze(sourceSrt(testCase.source), map);
  const result = {
    name: testCase.name,
    durationMs: plan.durationMs,
    plans: plan.rows.map((row, i) => ({
      id: testCase.source[i].id,
      status: row.status,
      fragments: row.fragments.map(f => ({sourceStartMs: f.sourceStartMs, sourceEndMs: f.sourceEndMs,
        startMs: f.outputStartMs, endMs: f.outputEndMs})),
    })),
  };
  const decisions = emptyDecisions(plan);
  for (let i = 0; i < plan.rows.length; i++) {
    const decision = testCase.decisions?.[testCase.source[i].id];
    if (decision) decisions.decisions[plan.rows[i].id] = normalizeDecision(decision);
  }
  try {
    const bundle = exportBundle(plan, decisions);
    result.output = bundle.result.cues.map(({number,startMs,endMs,text}) => ({number,startMs,endMs,text}));
    result.srt = bundle.srt;
  } catch (error) {
    result.exportError = error.code || String(error);
  }
  results.push(result);
}
const output = JSON.stringify(results);
if (process.argv[3]) fs.writeFileSync(process.argv[3], output);
else process.stdout.write(output + '\n');

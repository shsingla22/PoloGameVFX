import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadlessMatch } from '../src/sim/headless.js';

test('AI-vs-AI match completes with goals, hits and few fouls', () => {
  const { match, log } = runHeadlessMatch({ seconds: 900, chukkers: 4, chukkerSeconds: 150 });
  const goals = log.filter((e) => e.t === 'goal').length;
  const fouls = log.filter((e) => e.t === 'foul');
  console.log('score', match.score, 'hits', match.stats.hits, 'fouls', match.stats.fouls, 'outs', log.filter((e) => e.t === 'out').length, 'state', match.state);
  for (const f of fouls.slice(0, 5)) console.log('  foul', f.reason, f.time.toFixed(1));
  assert.equal(match.state, 'fulltime');
  assert.ok(goals >= 2, `expected some goals, got ${goals}`);
  assert.ok(match.stats.hits[0] + match.stats.hits[1] > 30, 'expected plenty of hits');
  assert.ok(fouls.length < 25, `too many fouls: ${fouls.length}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadlessMatch } from '../src/sim/headless.js';

// The sim is stochastic (AI decisions use Math.random), so assert on averages over several matches.
test('AI-vs-AI matches complete with sensible goals, hits and fouls', () => {
  const N = 4;
  let goals = 0, hits = 0, fouls = 0;
  for (let i = 0; i < N; i++) {
    const { match, log } = runHeadlessMatch({ seconds: 900, chukkers: 4, chukkerSeconds: 150 });
    assert.equal(match.state, 'fulltime');
    goals += log.filter((e) => e.t === 'goal').length;
    fouls += log.filter((e) => e.t === 'foul').length;
    hits += match.stats.hits[0] + match.stats.hits[1];
    for (const r of match.riders) assert.ok(Math.abs(r.pos.x) <= 45 && Math.abs(r.pos.z) <= 23, 'rider escaped the arena');
  }
  console.log(`avg per match: goals ${goals / N}, hits ${hits / N}, fouls ${fouls / N}`);
  assert.ok(goals / N >= 4 && goals / N <= 22, `goals per match out of range: ${goals / N}`);
  assert.ok(hits / N > 50, 'expected plenty of hits');
  assert.ok(fouls / N <= 15, `too many fouls per match: ${fouls / N}`);
});

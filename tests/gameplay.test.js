import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/game/sim.js';
import { SIM_DT, GAITS } from '../src/config.js';

/** A competent human: rides to put the ball on the off-side, swings when the ring goes green. */
function playAsHuman(sim, seconds) {
  const P = sim.player, m = sim.match;
  let swings = 0, hits = 0, lastHit = -1, held = false, releaseAt = 0;
  for (let i = 0; i < seconds / SIM_DT && m.state !== 'fulltime'; i++) {
    const b = sim.ball.pos, gx = m.goalX(P.team);
    const ax = gx - b.x, az = -b.z * 0.7, al = Math.hypot(ax, az);
    const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z);
    const lead = Math.min(1, d / 15), back = d > 9 ? 5 : -2;
    const tx = b.x + sim.ball.vel.x * lead - (ax / al) * back + (az / al) * 1.15;
    const tz = b.z + sim.ball.vel.z * lead - (az / al) * back - (ax / al) * 1.15;
    let dh = Math.atan2(tz - P.pos.z, tx - P.pos.x) - P.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const frozen = m.state === 'throwin' || (m.state === 'freehit' && m.freeHit?.hitterId !== P.id);
    P.steer = frozen ? 0 : Math.max(-1, Math.min(1, dh * 3));
    P.desiredSpeed = frozen ? 0 : GAITS[Math.abs(dh) > 1.6 ? 2 : 4].speed;
    P.aimDir.set(ax / al, 0, az / al); P.aimBlend = 0.85;
    if (P.canSwing() && !held && (m.state === 'play' || m.state === 'freehit') && sim.strikeZone() === 2) {
      const lat = (b.x - P.pos.x) * P.right.x + (b.z - P.pos.z) * P.right.z;
      P.beginSwing('fore', lat < 0 ? -1 : 1); held = true; releaseAt = sim.time + 0.12; swings++;
    }
    if (held && sim.time >= releaseAt) { sim.requestRelease(true); held = false; }
    sim.step(SIM_DT);
    if (sim.ball.lastHitBy === P.id && sim.ball.lastHitTime > lastHit) { lastHit = sim.ball.lastHitTime; hits++; }
  }
  return { swings, hits };
}

test('swing assist + green-ring timing lets a competent player connect most of the time', () => {
  const sim = new Sim({ difficulty: 'club' }); sim.start();
  const { swings, hits } = playAsHuman(sim, 300);
  console.log(`player swings ${swings}, hits ${hits} (${Math.round((100 * hits) / swings)}%)`);
  assert.ok(swings > 20);
  assert.ok(hits / swings > 0.45, `hit rate too low: ${hits}/${swings}`);
});

test('pony sense keeps an aggressive human from racking up dangerous-riding fouls', () => {
  let fouls = 0;
  for (let k = 0; k < 3; k++) {
    const sim = new Sim({ difficulty: 'club' });
    sim.match.on((t, d) => { if (t === 'foul' && d.offender === sim.player.id && d.reason === 'Dangerous riding') fouls++; });
    sim.start();
    playAsHuman(sim, 300);
  }
  console.log(`player dangerous-riding fouls over 15 min: ${fouls}`);
  assert.ok(fouls / 3 <= 3, `too many: ${fouls}`);
});

test('calling for the ball makes the teammate chaser pass to the player', () => {
  let passes = 0;
  for (let k = 0; k < 6 && !passes; k++) {
    const sim = new Sim({ difficulty: 'highgoal' }); sim.start();
    const P = sim.player;
    for (let i = 0; i < 40 / SIM_DT; i++) {
      P.desiredSpeed = GAITS[3].speed; P.steer = 0;
      if (sim.match.state === 'play' && i % 60 === 0) sim.callForPass();
      sim.step(SIM_DT);
      const brain = sim.brains.find((b) => b.passing);
      if (brain) { passes++; break; }
    }
  }
  assert.ok(passes > 0, 'a teammate should line up a pass to the player');
});

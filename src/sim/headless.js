// Headless match runner (no rendering): used by tests and for AI balance tuning.
import { BallPhysics } from '../game/ball.js';
import { Rider } from '../game/rider.js';
import { Match, confineRider } from '../game/rules.js';
import { Brain } from '../game/ai.js';
import { BALL, DIFFICULTY, SIM_DT } from '../config.js';

export function runHeadlessMatch({ seconds = 600, chukkers = 4, chukkerSeconds = 150, diffA = 'club', diffB = 'club' } = {}) {
  const roster = [
    ['attack', 0, 1], ['mid', 0, 2], ['back', 0, 3], ['attack', 1, 1], ['mid', 1, 2], ['back', 1, 3],
  ];
  const riders = roster.map(([role, team, number], id) => new Rider({ id, team, number, role }));
  const ball = new BallPhysics();
  const brains = riders.map((r) => new Brain(r, DIFFICULTY[r.team === 0 ? diffA : diffB]));
  const match = new Match(riders, ball, { chukkers, chukkerSeconds });
  const log = [];
  match.on((t, d) => log.push({ t, time: match.time, ...d }));
  match.start();
  let time = 0;
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps && match.state !== 'fulltime'; i++) {
    const ctx = { match, ball, riders, time };
    for (const b of brains) b.update(SIM_DT, ctx);
    for (const r of riders) { r.update(SIM_DT); confineRider(r); }
    if (match.state !== 'throwin') ball.step(SIM_DT);
    else { ball.pos.set(match.throwInSpot.x, 2, match.throwInSpot.z - 10.3); ball.vel.set(0, 0, 0); }
    match.handleBallEvents(ball.drainEvents());
    if (match.state === 'play' || match.state === 'freehit') {
      for (const r of riders) {
        if (match.state === 'freehit' && match.freeHit?.hitterId !== r.id) continue;
        const shot = r.testHit(ball, BALL.radius, time);
        if (shot) { ball.strike(shot.dir, shot.speed, shot.loft, r.id, time); match.registerHit(r, shot); break; }
      }
    }
    match.update(SIM_DT);
    time += SIM_DT;
  }
  return { match, log, time };
}

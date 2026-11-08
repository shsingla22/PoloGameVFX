import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BallPhysics, segmentPointDistance } from '../src/game/ball.js';
import { Rider } from '../src/game/rider.js';
import { Match } from '../src/game/rules.js';
import { ARENA, BALL, SIM_DT } from '../src/config.js';

const run = (ball, secs) => { const ev = []; for (let t = 0; t < secs; t += SIM_DT) { ball.step(SIM_DT); ev.push(...ball.drainEvents()); } return ev; };

test('rolling ball slows to a stop on turf', () => {
  const b = new BallPhysics();
  b.vel.set(10, 0, 0);
  run(b, 8);
  assert.ok(b.speed < 0.01);
  assert.ok(b.pos.x > 15 && b.pos.x < 30, `rolled ${b.pos.x}`);
});

test('lofted ball bounces and settles on the ground', () => {
  const b = new BallPhysics();
  b.vel.set(5, 6, 0);
  const ev = run(b, 6);
  assert.ok(ev.some((e) => e.type === 'bounce'));
  assert.ok(Math.abs(b.pos.y - BALL.radius) < 1e-6);
});

test('ball rebounds off the side boards', () => {
  const b = new BallPhysics();
  b.vel.set(0, 0, 20);
  const ev = run(b, 1.5);
  assert.ok(ev.some((e) => e.type === 'board'));
  assert.ok(b.pos.z < ARENA.width / 2);
});

test('ball through the goal mouth scores; wide of it hits the end board', () => {
  const g = new BallPhysics(); g.reset(ARENA.length / 2 - 5, 0); g.vel.set(15, 0, 0);
  assert.ok(run(g, 1).some((e) => e.type === 'goal' && e.side === 1));
  const w = new BallPhysics(); w.reset(ARENA.length / 2 - 5, 10); w.vel.set(15, 0, 0);
  const ev = run(w, 1);
  assert.ok(!ev.some((e) => e.type === 'goal'));
  assert.ok(ev.some((e) => e.type === 'board'));
});

test('ball over the boards goes out of play', () => {
  const b = new BallPhysics(); b.reset(0, ARENA.width / 2 - 2, 3); b.vel.set(0, 2, 15);
  assert.ok(run(b, 1).some((e) => e.type === 'out'));
});

test('segmentPointDistance', () => {
  const { dist } = segmentPointDistance(new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(1, 1, 0));
  assert.ok(Math.abs(dist - 1) < 1e-9);
});

test('forehand swing strikes a ball on the off-side and sends it forward', () => {
  const r = new Rider({ id: 0, team: 0, number: 1, role: 'mid' });
  r.place(0, 0, 0);                         // facing +X, off-side is +Z
  r.desiredSpeed = 8; r.speed = 8;
  const b = new BallPhysics();
  // Ball placed beside the pony where the mallet head bottoms out.
  r.beginSwing('fore', 1);
  let shot = null;
  for (let t = 0; t < 1.2 && !shot; t += SIM_DT) {
    if (r.swing.state === 'windup' && r.swing.t > 0.25) r.releaseSwing(1);
    r.update(SIM_DT);
    if (!shot && r.swing.state === 'strike') b.reset(r.pos.x + 0.4, 1.17);
    shot = r.testHit(b, BALL.radius, t);
  }
  assert.ok(shot, 'expected contact');
  assert.ok(shot.dir.x > 0.8, `forward dir ${shot.dir.x}`);
  assert.ok(shot.speed > 10, `speed ${shot.speed}`);
});

test('match: goal scores for the attacking team and teams switch ends', () => {
  const riders = [new Rider({ id: 0, team: 0, number: 1, role: 'attack' }), new Rider({ id: 1, team: 1, number: 1, role: 'attack' })];
  const b = new BallPhysics();
  const m = new Match(riders, b, { chukkerSeconds: 60 });
  m.start();
  for (let t = 0; t < 3; t += SIM_DT) m.update(SIM_DT);
  assert.equal(m.state, 'play');
  m.handleBallEvents([{ type: 'goal', side: 1, pos: new Vector3(46, 0, 0) }]);
  assert.deepEqual(m.score, [1, 0]);
  for (let t = 0; t < 5; t += SIM_DT) m.update(SIM_DT);
  assert.deepEqual(m.attackDir, [-1, 1]);
  assert.equal(m.state, 'throwin');
});

test('match: tie after last chukker goes to golden-goal extra chukker', () => {
  const riders = [new Rider({ id: 0, team: 0, number: 1, role: 'attack' }), new Rider({ id: 1, team: 1, number: 1, role: 'attack' })];
  const m = new Match(riders, new BallPhysics(), { chukkers: 1, chukkerSeconds: 5 });
  const ev = []; m.on((t) => ev.push(t));
  m.start();
  for (let t = 0; t < 30 && !(m.overtime && m.state === 'play'); t += SIM_DT) m.update(SIM_DT);
  assert.ok(ev.includes('overtime'));
  assert.equal(m.state, 'play');
  assert.equal(m.chukker, 2);
  m.handleBallEvents([{ type: 'goal', side: -1, pos: new Vector3() }]);
  for (let t = 0; t < 6; t += SIM_DT) m.update(SIM_DT);
  assert.equal(m.state, 'fulltime');
});

test('match: crossing in front of the right-of-way holder is a foul', () => {
  const holder = new Rider({ id: 0, team: 0, number: 1, role: 'attack' });
  const crosser = new Rider({ id: 1, team: 1, number: 1, role: 'attack' });
  const b = new BallPhysics();
  const m = new Match([holder, crosser], b, { chukkerSeconds: 60 });
  m.state = 'play';
  holder.place(0, 0, 0); holder.speed = 12;
  b.reset(3, 0); b.vel.set(12, 0, 0);
  m.registerHit(holder, { dir: new Vector3(1, 0, 0) });
  crosser.place(5, -2, Math.PI / 2); crosser.speed = 10;   // riding across the line, 5 m ahead
  const ev = []; m.on((t, d) => ev.push([t, d]));
  for (let i = 0; i < 60; i++) { holder.update(SIM_DT); crosser.update(SIM_DT); b.step(SIM_DT); m.update(SIM_DT); }
  assert.ok(ev.some(([t, d]) => t === 'foul' && d.offender === 1), 'expected crossing foul');
});

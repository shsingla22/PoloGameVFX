import { ARENA, BALL, GAITS, DIFFICULTY } from '../config.js';
import { BallPhysics } from './ball.js';
import { Rider } from './rider.js';
import { Match, confineRider } from './rules.js';
import { Brain } from './ai.js';

export const ROSTER = [
  { team: 0, number: 1, role: 'attack' }, { team: 0, number: 2, role: 'mid', isPlayer: true }, { team: 0, number: 3, role: 'back' },
  { team: 1, number: 1, role: 'attack' }, { team: 1, number: 2, role: 'mid' }, { team: 1, number: 3, role: 'back' },
];

const PONY_R = 0.52;          // two-circle pony collision (forehand + hindquarters)

/**
 * The complete, rendering-free match simulation. The game wraps this for visuals/audio,
 * and the tests run exactly the same code headlessly.
 */
export class Sim {
  constructor({ difficulty = 'club', chukkers = 4, chukkerSeconds = 150, playerIsAI = false, hooks = {} } = {}) {
    this.hooks = hooks;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.club;
    this.time = 0;
    this.ball = new BallPhysics();
    this.riders = ROSTER.map((d, i) => new Rider({ id: i, ...d }));
    this.player = this.riders.find((r) => r.isPlayer);
    this.player.hitRadiusBonus = 0.42;
    this.brains = this.riders.filter((r) => playerIsAI || !r.isPlayer).map((r) => {
      // At Novice your own teammates are a notch better than the opposition.
      const d = r.team === 0 && difficulty === 'novice' ? DIFFICULTY.club : r.isPlayer ? DIFFICULTY.highgoal : this.diff;
      return new Brain(r, d);
    });
    this.umpire = new Rider({ id: 99, team: 0, number: 0, role: 'ump' });
    this.match = new Match(this.riders, this.ball, { chukkers, chukkerSeconds });
    this.contactTimers = new Map();
    this.passRequest = -10;
    this.pendingRelease = false;
    this.releaseWait = 0;
  }

  start() {
    this.match.start();
    this.umpire.place(0, -ARENA.width / 2 + 4, Math.PI / 2);
  }

  /** Player asked a teammate to pass ("E"). */
  callForPass() { this.passRequest = this.time; }

  /**
   * Desktop swing assist: after the player releases, hold the strike at the top for up to
   * ~0.4 s until the ball reaches the contact point, so timing is about lining up, not ms reflexes.
   */
  requestRelease(assist = true) {
    const p = this.player;
    if (p.swing.state !== 'windup') return;
    if (!assist) { p.releaseSwing(); return; }
    this.pendingRelease = true;
    this.releaseWait = 0;
  }

  updatePendingRelease(dt) {
    const p = this.player;
    if (!this.pendingRelease) return;
    if (p.swing.state !== 'windup') { this.pendingRelease = false; return; }
    this.releaseWait += dt;
    const b = this.ball;
    const f = p.forward, r = p.right;
    const rx = b.pos.x - p.pos.x, rz = b.pos.z - p.pos.z;
    const fwd = rx * f.x + rz * f.z, lat = (rx * r.x + rz * r.z) * p.swing.side;
    const relSpeed = p.speed - (b.vel.x * f.x + b.vel.z * f.z);
    const tc = p.swing.kind === 'fore' ? 0.14 : 0.12;          // release -> mallet at the bottom
    const atContact = fwd - relSpeed * tc;
    const inLane = lat > 0.35 && lat < 2.1 && b.pos.y < 0.8;
    const ready = !inLane || Math.abs(atContact) < 0.35 || atContact < -0.2 || this.releaseWait > 0.42;
    if (ready) { p.releaseSwing(); this.pendingRelease = false; }
  }

  /**
   * Is the ball in the player's strike lane? 2 = start the swing now, 1 = coming up, 0 = no.
   * Time-based: a swing takes ~0.45 s from wind-up to contact, so at a gallop "now" is several metres out.
   */
  strikeZone(rider = this.player) {
    const b = this.ball, f = rider.forward, r = rider.right;
    if (b.pos.y > 0.8) return 0;
    const rx = b.pos.x - rider.pos.x, rz = b.pos.z - rider.pos.z;
    const fwd = rx * f.x + rz * f.z, lat = Math.abs(rx * r.x + rz * r.z);
    if (lat < 0.45 || lat > 1.95) return 0;
    const rel = rider.speed - (b.vel.x * f.x + b.vel.z * f.z);
    if (rel < 1.2) return fwd > -0.3 && fwd < 1.4 ? 2 : fwd >= 1.4 && fwd < 6 ? 1 : 0;
    const t = fwd / rel;
    if (t > 0.18 && t < 0.62) return 2;
    if (t >= 0.62 && t < 2.0) return 1;
    return 0;
  }

  /**
   * Pony sense: a real polo pony won't T-bone another horse. If the human's line would hit
   * an opponent side-on at speed within ~0.7 s, the pony checks and eases away.
   */
  ponySense(dt) {
    const p = this.player;
    if (p.speed < 5) { this.ponyWarn = false; return; }
    let threat = null;
    for (const q of this.riders) {
      if (q === p) continue;
      const px = q.pos.x - p.pos.x, pz = q.pos.z - p.pos.z;
      const vx = q.vel.x - p.vel.x, vz = q.vel.z - p.vel.z, vv = vx * vx + vz * vz;
      if (vv < 4) continue;
      const t = -(px * vx + pz * vz) / vv;
      if (t < 0 || t > 0.7) continue;
      const mx = px + vx * t, mz = pz + vz * t;
      if (mx * mx + mz * mz > 1.6 * 1.6) continue;
      if (Math.abs(p.forward.dot(q.forward)) > 0.6) continue;   // near-parallel: ride-off, allowed
      threat = { q, t, side: Math.sign(px * p.right.x + pz * p.right.z) || 1 };
      break;
    }
    this.ponyWarn = !!threat;
    if (threat) {
      p.desiredSpeed = Math.min(p.desiredSpeed, p.speed * 0.6);
      p.steer -= threat.side * 0.8;
    }
    void dt;
  }

  step(dt) {
    const m = this.match;
    const ctx = { match: m, ball: this.ball, riders: this.riders, time: this.time, passTo: this.time - this.passRequest < 2.5 ? this.player : null };
    for (const b of this.brains) b.update(dt, ctx);
    if (!this.brains.some((b) => b.r === this.player)) this.ponySense(dt);
    this.updatePendingRelease(dt);
    for (const r of this.riders) r.trackBall(this.ball.pos);
    for (const r of this.riders) {
      r.update(dt);
      if (this.hooks.footfall) for (const leg of r.footfalls) this.hooks.footfall(r, leg);
    }
    this.collideRiders(dt);
    for (const r of this.riders) confineRider(r);
    this.updateUmpire(dt);

    if (m.state !== 'throwin') {
      this.ball.step(dt);
      this.collideBallHorses();
    } else {
      const u = this.umpire;
      this.ball.pos.set(u.pos.x + u.forward.x * 0.7, 2.0, u.pos.z + u.forward.z * 0.7);
      this.ball.vel.set(0, 0, 0);
    }
    m.handleBallEvents(this.ball.drainEvents());

    const st = m.state;
    if (st === 'play' || st === 'freehit') {
      for (const r of this.riders) {
        if (st === 'freehit' && m.freeHit?.hitterId !== r.id) continue;
        const shot = r.testHit(this.ball, BALL.radius, this.time);
        if (!shot) continue;
        this.ball.strike(shot.dir, shot.speed, shot.loft, r.id, this.time);
        m.registerHit(r, shot);
        if (r.isPlayer) this.passRequest = -10;
        this.hooks.hit && this.hooks.hit(r, shot);
        break;
      }
    }
    m.update(dt);
    this.time += dt;
  }

  collideRiders(dt) {
    const rs = this.riders;
    for (const [k, v] of this.contactTimers) if (v > 0) this.contactTimers.set(k, v - dt);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (Math.abs(a.pos.x - b.pos.x) > 4 || Math.abs(a.pos.z - b.pos.z) > 4) continue;
      const fa = a.forward, fb = b.forward;
      let best = null;
      for (const oa of [0.6, -0.6]) for (const ob of [0.6, -0.6]) {
        const ax = a.pos.x + fa.x * oa, az = a.pos.z + fa.z * oa;
        const bx = b.pos.x + fb.x * ob, bz = b.pos.z + fb.z * ob;
        const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
        const pen = 2 * PONY_R - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0 };
      }
      if (!best) continue;
      const push = best.pen * 0.5;
      a.pos.x -= best.nx * push; a.pos.z -= best.nz * push;
      b.pos.x += best.nx * push; b.pos.z += best.nz * push;
      const closing = (a.vel.x - b.vel.x) * best.nx + (a.vel.z - b.vel.z) * best.nz;
      if (closing > 0) { a.speed *= 0.985; b.speed *= 0.985; }
      const key = i * 10 + j;
      if (!(this.contactTimers.get(key) > 0)) {
        this.contactTimers.set(key, 0.8);
        // How hard each pony was driving into the other along the contact normal.
        const aIn = a.vel.x * best.nx + a.vel.z * best.nz;
        const bIn = -(b.vel.x * best.nx + b.vel.z * best.nz);
        this.match.registerContact(a, b, { aIn, bIn, closing });
        this.hooks.contact && this.hooks.contact(a, b, closing);
      }
    }
  }

  collideBallHorses() {
    const b = this.ball;
    if (b.pos.y > 1.3) return;
    for (const r of this.riders) {
      const f = r.forward;
      for (const o of [0.5, -0.5]) {
        const cx = r.pos.x + f.x * o, cz = r.pos.z + f.z * o;
        const dx = b.pos.x - cx, dz = b.pos.z - cz, d = Math.hypot(dx, dz);
        const rad = 0.32 + BALL.radius;
        if (d < rad && d > 1e-4) {
          const nx = dx / d, nz = dz / d;
          b.pos.x = cx + nx * rad; b.pos.z = cz + nz * rad;
          const vn = (b.vel.x - r.vel.x) * nx + (b.vel.z - r.vel.z) * nz;
          if (vn < 0) { b.vel.x -= 1.5 * vn * nx; b.vel.z -= 1.5 * vn * nz; b.vel.multiplyScalar(0.7); }
        }
      }
    }
  }

  updateUmpire(dt) {
    const u = this.umpire, b = this.ball.pos, m = this.match;
    let tx, tz;
    if (m.state === 'throwin') { const s = m.throwInSpot; tx = s.x; tz = s.z - 11; }
    else { tx = b.x - Math.sign(b.x || 1) * 8; tz = b.z > 0 ? b.z - 12 : b.z + 12; }
    const dx = tx - u.pos.x, dz = tz - u.pos.z, d = Math.hypot(dx, dz);
    if (m.state === 'throwin' && d < 2) { u.targetHeading = Math.PI / 2; u.desiredSpeed = 0; }
    else { u.targetHeading = Math.atan2(dz, dx); u.desiredSpeed = Math.min(GAITS[4].speed, d * 0.8); }
    if (m.state === 'throwin' && m.stateTime < 0.05) u.place(tx, tz, Math.PI / 2);
    u.update(dt);
    confineRider(u);
  }
}

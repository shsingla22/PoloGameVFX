import { Vector3 } from 'three';
import { ARENA, BALL } from '../config.js';

/**
 * Polo ball simulation: gravity, quadratic air drag, bouncy turf with rolling
 * resistance, and the arena boards. Goal mouths are open gaps in the end boards.
 * Pure logic (no rendering) so it can be unit-tested headlessly.
 */
export class BallPhysics {
  constructor() {
    this.pos = new Vector3(0, BALL.radius, 0);
    this.vel = new Vector3();
    this.spin = new Vector3();       // visual roll axis * rate
    this.events = [];                // {type:'bounce'|'board'|'goal'|'out', ...}
    this.lastHitBy = null;
    this.lastHitTime = -1;
    this.inGoal = false;
  }

  reset(x = 0, z = 0, y = BALL.radius) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.inGoal = false;
  }

  get speed() { return this.vel.length(); }

  step(dt) {
    const r = BALL.radius;
    const halfL = ARENA.length / 2;
    const halfW = ARENA.width / 2;
    const p = this.pos, v = this.vel;
    if (this.inGoal) {
      // Trapped in the net: damp out quickly.
      v.multiplyScalar(Math.max(0, 1 - 4 * dt));
      v.y -= BALL.gravity * dt;
      p.addScaledVector(v, dt);
      if (p.y < r) { p.y = r; v.y = 0; }
      return;
    }

    const airborne = p.y > r + 1e-3 || v.y > 0.05;
    if (airborne) {
      v.y -= BALL.gravity * dt;
      const s = v.length();
      if (s > 0) v.multiplyScalar(Math.max(0, 1 - BALL.airDrag * s * dt));
    } else {
      // Rolling on turf.
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0) {
        const ns = Math.max(0, hs - BALL.rollingDecel * dt - 0.02 * hs * dt);
        v.x *= ns / hs; v.z *= ns / hs;
      }
      v.y = 0; p.y = r;
    }

    const prevX = p.x;
    p.addScaledVector(v, dt);

    // Ground contact.
    if (p.y < r) {
      p.y = r;
      if (v.y < -1.2) {
        this.events.push({ type: 'bounce', speed: -v.y, pos: p.clone() });
        v.y = -v.y * BALL.restitutionGround;
        v.x *= 0.92; v.z *= 0.92;
      } else {
        v.y = 0;
      }
    }

    // Side boards (long walls). Ball sailing above board height leaves play.
    if (Math.abs(p.z) > halfW - r) {
      if (p.y > ARENA.boardHeight) {
        this.events.push({ type: 'out', pos: p.clone() });
      } else {
        p.z = Math.sign(p.z) * (halfW - r);
        this.events.push({ type: 'board', speed: Math.abs(v.z), pos: p.clone() });
        v.z = -v.z * BALL.restitutionBoards;
        v.x *= 0.9;
      }
    }

    // End boards with a goal mouth in the middle.
    if (Math.abs(p.x) > halfL - r) {
      const side = Math.sign(p.x);
      const inMouth = Math.abs(p.z) < ARENA.goalWidth / 2 - r && p.y < ARENA.goalHeight;
      if (inMouth) {
        // Goal is scored when the whole ball crosses the line.
        if (Math.abs(p.x) > halfL + r && Math.abs(prevX) <= halfL + r) {
          this.inGoal = true;
          this.events.push({ type: 'goal', side, pos: p.clone() });
        }
        if (Math.abs(p.x) > halfL + ARENA.goalDepth - r) {
          p.x = side * (halfL + ARENA.goalDepth - r);
          v.x = -v.x * 0.2;
        }
      } else if (p.y > ARENA.boardHeight) {
        this.events.push({ type: 'out', pos: p.clone() });     // over the end line
      } else {
        // Hit the end boards or clipped a goal post.
        const post = Math.abs(p.z) < ARENA.goalWidth / 2 + r;
        p.x = side * (halfL - r);
        this.events.push({ type: post ? 'post' : 'board', speed: Math.abs(v.x), pos: p.clone() });
        v.x = -v.x * (post ? 0.5 : BALL.restitutionBoards);
        v.z *= 0.9;
      }
    }

    // Visual spin: roll without slipping when on the ground.
    this.spin.set(v.z, 0, -v.x).divideScalar(r);
  }

  /** Apply a strike. dir need not be normalised; speed in m/s. */
  strike(dir, speed, loft, byId, time) {
    const d = new Vector3(dir.x, 0, dir.z).normalize();
    const s = Math.min(speed, BALL.maxSpeed);
    this.vel.set(d.x * s, Math.max(0, loft) * s, d.z * s);
    if (this.pos.y < BALL.radius + 0.01) this.pos.y = BALL.radius + 0.011;
    this.lastHitBy = byId;
    this.lastHitTime = time;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** Closest distance between segment AB and point P (all Vector3). */
export function segmentPointDistance(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return { dist: Math.sqrt(dx * dx + dy * dy + dz * dz), t };
}

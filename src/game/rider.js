import { Vector3 } from 'three';
import { HORSE, MALLET, GAITS } from '../config.js';
import { segmentPointDistance } from './ball.js';

const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const REST = 2.6;          // mallet carried upright, slightly forward
const easeInOut = (u) => u * u * (3 - 2 * u);

/**
 * A mounted player: pony locomotion + rider mallet swing.
 * Heading h -> forward = (cos h, 0, sin h); off-side (right) = (-sin h, 0, cos h).
 */
export class Rider {
  constructor({ id, team, number, role, isPlayer = false }) {
    this.id = id;
    this.team = team;
    this.number = number;
    this.role = role;              // 'attack' | 'mid' | 'back'
    this.isPlayer = isPlayer;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.heading = 0;
    this.yawRate = 0;
    this.speed = 0;
    this.desiredSpeed = 0;
    this.steer = 0;                // -1 left .. +1 right (AI may use targetHeading instead)
    this.targetHeading = null;
    this.sprint = false;
    this.stamina = 1;
    this.speedMul = 1;
    this.lean = 0;
    this.gaitPhase = Math.random();
    this.footfalls = [];           // filled each step with leg indices that planted
    // Swing state
    this.swing = { state: 'idle', t: 0, kind: 'fore', side: 1, power: 1, from: REST, to: REST, hit: false, charge: 0 };
    this.malletAngle = REST;
    this.malletSide = 1;
    this.head = new Vector3();
    this.prevHead = new Vector3();
    this.headVel = new Vector3();
    this.shoulder = new Vector3();
    this.aimDir = new Vector3(1, 0, 0);
    this.aimBlend = 0.75;
    this.vrMallet = null;          // {head:Vector3, prev:Vector3} when driven by a VR controller
    this.lastHitTime = -10;
    this.hitRadiusBonus = 0.12;     // forgiving contact for game feel
    this.foulCooldown = 0;
    this.computeHead();
    this.prevHead.copy(this.head);
  }

  get forward() { return new Vector3(Math.cos(this.heading), 0, Math.sin(this.heading)); }
  get right() { return new Vector3(-Math.sin(this.heading), 0, Math.cos(this.heading)); }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.desiredSpeed = 0;
    this.vel.set(0, 0, 0);
    this.swing.state = 'idle';
    this.malletAngle = REST;
    this.computeHead();
    this.prevHead.copy(this.head);
  }

  gaitIndex() {
    let g = 0;
    for (let i = 0; i < GAITS.length; i++) if (this.speed >= GAITS[i].speed * 0.8) g = i;
    return g;
  }

  update(dt) {
    // --- Speed ---
    const maxSpeed = (this.sprint && this.stamina > 0.05 ? HORSE.sprintSpeed : GAITS[4].speed) * this.speedMul;
    const want = Math.min(this.desiredSpeed, maxSpeed);
    const rate = want > this.speed ? HORSE.accel : HORSE.brake;
    this.speed += Math.sign(want - this.speed) * Math.min(Math.abs(want - this.speed), rate * dt);
    if (this.sprint && this.speed > GAITS[4].speed) this.stamina = Math.max(0, this.stamina - HORSE.staminaDrain * dt);
    else this.stamina = Math.min(1, this.stamina + HORSE.staminaRegen * dt);

    // --- Turning --- (ponies turn tighter when slower)
    const k = Math.min(1, this.speed / HORSE.sprintSpeed);
    const turnRate = HORSE.turnRateSlow + (HORSE.turnRateFast - HORSE.turnRateSlow) * k;
    let steer = this.steer;
    if (this.targetHeading !== null) {
      let d = this.targetHeading - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      steer = Math.max(-1, Math.min(1, d * 2.5));
    }
    const yawTarget = steer * turnRate;
    this.yawRate += (yawTarget - this.yawRate) * Math.min(1, dt * 8);
    this.heading += this.yawRate * dt;
    // Hard turns at speed scrub a little speed.
    this.speed = Math.max(0, this.speed - Math.abs(this.yawRate) * this.speed * 0.05 * dt);
    this.lean += ((this.yawRate * this.speed * 0.022) - this.lean) * Math.min(1, dt * 6);

    const f = this.forward;
    this.vel.copy(f).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);

    // --- Gait cycle & footfalls ---
    const strideLen = 1.2 + this.speed * 0.32;      // longer strides at speed
    const prevPhase = this.gaitPhase;
    this.gaitPhase = (this.gaitPhase + (this.speed / strideLen + (this.speed > 0.1 ? 0.15 : 0)) * dt) % 1;
    this.footfalls.length = 0;
    if (this.speed > 0.4) {
      const offs = legOffsets(this.speed);
      for (let i = 0; i < 4; i++) {
        const a = (prevPhase + offs[i]) % 1, b = (this.gaitPhase + offs[i]) % 1;
        if (b < a) this.footfalls.push(i);
      }
    }

    this.updateSwing(dt);
    if (this.foulCooldown > 0) this.foulCooldown -= dt;
  }

  // ----- Mallet -----
  canSwing() { return this.swing.state === 'idle' && !this.vrMallet; }

  /** Begin winding up. side: +1 off-side (right), -1 near-side. */
  beginSwing(kind = 'fore', side = 1) {
    if (!this.canSwing()) return false;
    const s = this.swing;
    s.state = 'windup'; s.t = 0; s.kind = kind; s.side = side; s.hit = false; s.charge = 0; s.lat = null;
    s.from = REST;
    s.to = kind === 'fore' ? REST + 1.38 : REST - 0.7;
    this.malletSide = side;
    return true;
  }

  /** Feed the ball's lateral offset (on the swing side) so the rider leans to meet it. */
  trackBall(ballPos) {
    const s = this.swing;
    if (s.state !== 'windup' && s.state !== 'strike') return;
    if (s.state === 'strike' && Math.cos(this.malletAngle) < -0.2) return;   // committed once past the bottom
    const r = this.right;
    const lat = ((ballPos.x - this.pos.x) * r.x + (ballPos.z - this.pos.z) * r.z) * s.side;
    if (lat > 0.35 && lat < 2.1) {
      const nominal = 1.17, range = this.leanRange ?? 0.7;     // how far this rider can lean
      const want = Math.max(nominal - range, Math.min(nominal + range, lat));
      s.lat = s.lat == null ? want : s.lat + (want - s.lat) * 0.35;
    }
  }

  /** Release the wind-up into the strike. power 0..1 */
  releaseSwing(power) {
    const s = this.swing;
    if (s.state !== 'windup') return;
    s.power = Math.max(0.35, Math.min(1, power ?? (0.45 + s.charge)));
    s.state = 'strike'; s.t = 0;
    s.from = this.malletAngle;
    s.to = s.kind === 'fore' ? TAU + 1.4 : -1.4;
  }

  updateSwing(dt) {
    if (this.vrMallet) return;          // head pose & velocity come from the tracked controller
    const s = this.swing;
    s.t += dt;
    if (s.state === 'windup') {
      const u = Math.min(1, s.t / 0.28);
      this.malletAngle = s.from + (s.to - s.from) * easeInOut(u);
      s.charge = Math.min(0.55, s.t * 0.75);
    } else if (s.state === 'strike') {
      const dur = MALLET.swingDuration * (s.kind === 'fore' ? 0.62 : 0.55);
      const u = Math.min(1, s.t / dur);
      this.malletAngle = s.from + (s.to - s.from) * easeInOut(u);
      if (u >= 1) { s.state = 'recover'; s.t = 0; s.from = this.malletAngle; s.to = s.kind === 'fore' ? TAU + REST : REST - TAU; }
    } else if (s.state === 'recover') {
      const u = Math.min(1, s.t / MALLET.recover);
      this.malletAngle = s.from + (s.to - s.from) * easeInOut(u);
      if (u >= 1) { s.state = 'idle'; this.malletAngle = REST; this.malletSide = 1; }
    }
    this.prevHead.copy(this.head);
    this.computeHead();
    if (dt > 0) this.headVel.subVectors(this.head, this.prevHead).divideScalar(dt);
  }

  computeHead() {
    if (this.vrMallet) {
      this.head.copy(this.vrMallet.head);
      return;
    }
    const f = this.forward, r = this.right;
    const side = this.malletSide;
    this.shoulder.copy(this.pos).addScaledVector(UP, MALLET.shoulderHeight).addScaledVector(r, MALLET.shoulderSide * side);
    const H = MALLET.shoulderHeight - 0.06;
    // Riders lean in or out of the saddle to meet the ball: the lateral reach follows the
    // ball's offset (lat, measured from the pony's centre line) within what a body can do.
    const baseL = Math.sqrt(Math.max(0.01, MALLET.reach * MALLET.reach - H * H));
    const L = this.swing.lat != null && this.swing.state !== 'idle' ? Math.max(0.28, Math.min(1.55, this.swing.lat - MALLET.shoulderSide)) : baseL;
    const reach = Math.sqrt(L * L + H * H);
    // d0: unit vector from shoulder to the ground contact point beside the pony.
    const d0x = r.x * side * L, d0y = -H, d0z = r.z * side * L;
    const c = Math.cos(this.malletAngle), sn = Math.sin(this.malletAngle);
    this.head.set(
      this.shoulder.x + d0x * c + f.x * sn * reach,
      this.shoulder.y + d0y * c,
      this.shoulder.z + d0z * c + f.z * sn * reach,
    );
    if (this.head.y < MALLET.headRadius * 0.5) this.head.y = MALLET.headRadius * 0.5;
  }

  /** Is the mallet currently live (able to strike the ball)? */
  isStriking() {
    if (this.vrMallet) return true;
    return this.swing.state === 'strike' && !this.swing.hit;
  }

  /**
   * Swept test of this frame's mallet-head motion against the ball.
   * Returns {speed, dir, loft} or null.
   */
  testHit(ball, ballRadius, time) {
    if (!this.isStriking()) return null;
    if (time - this.lastHitTime < 0.28) return null;
    const { dist } = segmentPointDistance(this.prevHead, this.head, ball.pos);
    if (dist > MALLET.headRadius + ballRadius + this.hitRadiusBonus) return null;

    const hv = this.headVel;
    const hs = Math.hypot(hv.x, hv.z);
    if (this.vrMallet && hv.length() < MALLET.vrMinHitSpeed) return null;
    this.lastHitTime = time;
    if (!this.vrMallet) this.swing.hit = true;

    const power = this.vrMallet ? 1 : this.swing.power;
    let speed = Math.max(5, hs * 0.52 * power);
    const dir = new Vector3(hv.x, 0, hv.z);
    if (dir.lengthSq() < 1e-4) dir.copy(this.forward);
    dir.normalize();
    // Aim assist / intent blend (AI targets, desktop aiming, VR assist).
    if (this.aimDir && this.aimBlend > 0 && dir.dot(this.aimDir) > -0.2) {
      dir.lerp(this.aimDir, this.aimBlend).normalize();
    }
    let loft;
    if (this.vrMallet) loft = Math.max(0, Math.min(0.45, hv.y / Math.max(1, hs))) + 0.04;
    else loft = 0.05 + power * 0.12 + Math.random() * 0.05;
    return { speed, dir, loft };
  }
}

/** Per-leg phase offsets [LF, RF, LH, RH] blended across gaits. */
export function legOffsets(speed) {
  // walk: 4-beat lateral; trot: diagonal pairs; canter/gallop: rotary 3/4-beat (right lead).
  const walk = [0.25, 0.75, 0.0, 0.5];
  const trot = [0.0, 0.5, 0.5, 0.0];
  const gallop = [0.55, 0.65, 0.0, 0.12];
  let a, b, t;
  if (speed < 3) { a = walk; b = trot; t = Math.max(0, (speed - 1.8) / 1.2); }
  else if (speed < 7) { a = trot; b = gallop; t = (speed - 3) / 4; }
  else { a = gallop; b = gallop; t = 0; }
  return a.map((v, i) => v + (b[i] - v) * t);
}

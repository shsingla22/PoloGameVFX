import { Vector3 } from 'three';
import { ARENA, GAITS } from '../config.js';
import { lateral } from './rules.js';

const tmp = new Vector3();
const tmp2 = new Vector3();

/**
 * Role-based polo AI.
 *  - one "chaser" per team (best time-to-ball) approaches so the ball sits on its off-side,
 *    times a forehand / near-side / backhand and aims at goal (or passes).
 *  - others hold role positions: No.1 forward, No.2 support, Back defends / marks.
 *  - respects the line of the ball: rides parallel instead of crossing the ROW holder.
 */
export class Brain {
  constructor(rider, difficulty) {
    this.r = rider;
    this.d = difficulty;
    this.think = Math.random() * 0.3;
    this.target = new Vector3();
    this.mode = 'hold';
    this.aimNoise = 0;
    this.releaseAt = -1;
    rider.speedMul = difficulty.speedMul;
    rider.aimBlend = 0.55 + difficulty.skill * 0.4;
    rider.leanRange = 0.08 + difficulty.skill * 0.3;
  }

  update(dt, ctx) {
    const r = this.r;
    const { match, ball } = ctx;
    r.sprint = false;
    r.steer = 0;

    // Release a wound-up swing at the planned moment.
    if (r.swing.state === 'windup' && r.swing.t >= this.releaseAt) r.releaseSwing(this.power ?? 0.8);

    const st = match.state;
    if (st === 'throwin') { r.desiredSpeed = 0; r.targetHeading = -Math.PI / 2; return; }
    if (st === 'goal' || st === 'foul' || st === 'out' || st === 'break' || st === 'fulltime') {
      r.desiredSpeed = Math.max(0, r.desiredSpeed - dt * 3);
      r.targetHeading = null;
      return;
    }
    if (st === 'freehit' && match.freeHit && match.freeHit.hitterId !== r.id) { r.desiredSpeed = 0; r.targetHeading = null; return; }

    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.d.reaction * (0.7 + Math.random() * 0.6);
      this.decide(ctx);
    }
    this.steerTo(dt, ctx);
    if (this.mode === 'chase') this.tryStrike(ctx);
  }

  decide(ctx) {
    const r = this.r;
    const { match, ball, riders } = ctx;
    const attackX = match.goalX(r.team);
    const ownX = match.ownGoalX(r.team);
    const dir = Math.sign(attackX);

    // Who on my team gets to the ball first?
    const lead = (q) => Math.min(1.6, q.pos.distanceTo(ball.pos) / (q.speed + 9));
    const eta = (q) => {
      tmp.copy(ball.pos).addScaledVector(ball.vel, lead(q));
      let t = q.pos.distanceTo(tmp) / 13;
      tmp2.subVectors(tmp, q.pos).normalize();
      t += (1 - q.forward.dot(tmp2)) * 0.6;          // turning costs time
      return t;
    };
    let mine = null, mineT = Infinity, theirsT = Infinity, theirs = null;
    for (const q of riders) {
      const t = eta(q);
      if (q.team === r.team) { if (t < mineT) { mineT = t; mine = q; } }
      else if (t < theirsT) { theirsT = t; theirs = q; }
    }
    this.weHaveIt = mineT < theirsT;
    this.mode = mine === r || (match.freeHit && match.freeHit.hitterId === r.id) ? 'chase' : 'position';

    // Shot selection
    const goal = new Vector3(attackX, 0, (Math.random() - 0.5) * ARENA.goalWidth * 0.55);
    this.aim = goal.sub(tmp.set(ball.pos.x, 0, ball.pos.z)).normalize();
    // The human called for the ball: pass to where they're going.
    if (this.mode === 'chase' && ctx.passTo && ctx.passTo.team === r.team && ctx.passTo !== r) {
      const q = ctx.passTo;
      const lead = Math.min(14, 4 + q.speed * 0.7);
      this.aim = new Vector3(q.pos.x + q.forward.x * lead - ball.pos.x, 0, q.pos.z + q.forward.z * lead - ball.pos.z).normalize();
      this.passing = true;
      return;
    }
    this.passing = false;
    // Pass to an open forward teammate sometimes.
    if (this.mode === 'chase' && Math.abs(ball.pos.x - attackX) > 35 && Math.random() < 0.35 + this.d.skill * 0.2) {
      const mate = riders.find((q) => q.team === r.team && q !== r && (q.pos.x - ball.pos.x) * dir > 10);
      if (mate) {
        const open = riders.every((o) => o.team === r.team || o.pos.distanceTo(mate.pos) > 7);
        if (open) this.aim = tmp.set(mate.pos.x + dir * 8 - ball.pos.x, 0, mate.pos.z - ball.pos.z).normalize().clone();
      }
    }
    // Shot power: dribble (tap it along) from long range, shoot hard near goal, passes measured.
    const distGoal = Math.hypot(attackX - ball.pos.x, ball.pos.z);
    if (this.passing) this.power = 0.6;
    else if (distGoal > 42) this.power = 0.45 + Math.random() * 0.15;
    else this.power = 0.7 + this.d.skill * 0.3;
    // Penalty pressure: set-piece shots are less certain than they look.
    if (match.state === 'freehit') this.power = 0.75 + Math.random() * 0.25;
    // Skill-based aim error, worse from distance.
    const err = (Math.random() - 0.5) * (1.3 - this.d.skill * 0.75) * (0.42 + distGoal / 50) * (match.state === 'freehit' ? 1.6 : 1);
    this.aim.applyAxisAngle(new Vector3(0, 1, 0), err);

    if (this.mode === 'position') {
      const b = ball.pos;
      const side = r.role === 'mid' ? (b.z > 0 ? -1 : 1) : (b.z > 0 ? 1 : -1);
      if (r.role === 'attack') {
        this.target.set(b.x + dir * 16, 0, b.z * 0.4 + side * 4);
        if (!this.weHaveIt && theirs) this.target.set(b.x + dir * 6, 0, b.z * 0.5);
      } else if (r.role === 'mid') {
        this.target.set(b.x - dir * 5, 0, b.z + side * 9);
        if (!this.weHaveIt && theirs) this.target.copy(theirs.pos).addScaledVector(theirs.right, 2.5); // ride him off
      } else {
        // Back: sit between ball and our goal; close to the mouth when the ball is in range (goal-keeping).
        this.target.set(ownX + (b.x - ownX) * 0.3, 0, b.z * 0.25);
        const toBall = new Vector3(b.x - ownX, 0, b.z);
        const dBall = toBall.length();
        if (dBall < 38) {
          toBall.normalize();
          this.target.set(ownX + toBall.x * Math.min(7, dBall * 0.35), 0, toBall.z * Math.min(7, dBall * 0.35));
        }
        if (!this.weHaveIt && theirs && Math.abs(theirs.pos.x - ownX) < 40) this.target.copy(theirs.pos).addScaledVector(tmp.set(ownX - theirs.pos.x, 0, -theirs.pos.z).normalize(), 3);
      }
    }
  }

  steerTo(dt, ctx) {
    const r = this.r;
    const { ball, match, riders } = ctx;
    let tgt = this.target;
    let speedCap = GAITS[4].speed;

    if (this.mode === 'chase') {
      const aim = this.aim;
      const right = tmp2.set(-aim.z, 0, aim.x);
      const leadT = Math.min(1.2, r.pos.distanceTo(ball.pos) / (r.speed + 10));
      const bp = tmp.copy(ball.pos).addScaledVector(ball.vel, leadT).setY(0);
      const dist = r.pos.distanceTo(bp);
      // Approach from behind the line of the shot with the ball on the off-side.
      const back = dist > 9 ? 5 : 1.5 - Math.min(1, ball.speed / 10) * 2;
      tgt = new Vector3().copy(bp).addScaledVector(aim, -back).addScaledVector(right, -1.15);
      if (dist < 9) tgt.addScaledVector(aim, 3);
      if (dist > 14 && r.stamina > 0.35) r.sprint = true;
      // Slow slightly when lining up a shot from a standstill ball.
      if (dist < 7 && ball.speed < 2) speedCap = GAITS[3].speed + 1.5;
    }

    // Separation from nearby ponies.
    const sep = new Vector3();
    for (const q of riders) {
      if (q === r) continue;
      const d = r.pos.distanceTo(q.pos);
      if (d < 4 && d > 0.01) sep.add(tmp.subVectors(r.pos, q.pos).multiplyScalar((4 - d) / d));
    }
    const goal = new Vector3().copy(tgt).addScaledVector(sep, 0.8);
    goal.x = Math.max(-ARENA.length / 2 + 3, Math.min(ARENA.length / 2 - 3, goal.x));
    goal.z = Math.max(-ARENA.width / 2 + 3, Math.min(ARENA.width / 2 - 3, goal.z));

    const to = new Vector3().subVectors(goal, r.pos);
    const d = to.length();
    let heading = Math.atan2(to.z, to.x);

    // Respect the line of the ball: don't cut across the ROW holder.
    const lob = match.lob;
    if (lob && match.state === 'play') {
      const holder = riders.find((q) => q.id === lob.holderId);
      if (holder && holder.team !== r.team && holder.speed > 4) {
        const ahead = tmp.subVectors(r.pos, holder.pos).dot(lob.dir);
        const lat = lateral(lob, r.pos);
        const futureLat = lateral(lob, tmp.copy(r.pos).addScaledVector(r.forward, r.speed * 0.8));
        if (ahead > -1 && ahead < 14 && Math.sign(lat) !== Math.sign(futureLat) || (ahead > -1 && ahead < 14 && Math.abs(lat) < 2.2)) {
          // Ride parallel to the line on our current side instead.
          heading = Math.atan2(lob.dir.z, lob.dir.x) + Math.sign(lat || 1) * 0.12;
        }
      }
    }
    // Predictive avoidance: don't T-bone anyone (that's a dangerous-riding foul).
    let brake = 1;
    for (const q of riders) {
      if (q === r) continue;
      const px = q.pos.x - r.pos.x, pz = q.pos.z - r.pos.z;
      if (px * px + pz * pz > 15 * 15) continue;
      const vx = q.vel.x - r.vel.x, vz = q.vel.z - r.vel.z;
      const vv = vx * vx + vz * vz;
      if (vv < 1) continue;
      const t = -(px * vx + pz * vz) / vv;                     // time of closest approach
      if (t < 0 || t > 1.1) continue;
      const mx = px + vx * t, mz = pz + vz * t;
      if (mx * mx + mz * mz > 2.4 * 2.4) continue;
      const angled = Math.abs(r.forward.dot(q.forward)) < 0.82;
      if (!angled) continue;                                    // parallel = ride-off, that's fine
      // Steer away from the side the other pony is on and check speed.
      const side = Math.sign(px * r.right.x + pz * r.right.z) || 1;
      heading -= side * 0.7 * (1.1 - t);
      brake = Math.min(brake, 0.45 + t * 0.4);
    }
    r.targetHeading = heading;
    let want = Math.min(speedCap, d * 1.3) * brake;
    // Slow for sharp turns.
    let dh = heading - r.heading;
    dh = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)));
    if (dh > 1.2) want = Math.min(want, GAITS[3].speed);
    if (dh > 2.2) want = Math.min(want, GAITS[2].speed + 1);
    if (this.mode === 'position' && d < 3) want = Math.min(want, GAITS[1].speed);
    r.desiredSpeed = want;
  }

  tryStrike(ctx) {
    const r = this.r;
    const { ball } = ctx;
    if (!r.canSwing() || ball.pos.y > 0.7) return;
    const rel = tmp.subVectors(ball.pos, r.pos);
    const f = r.forward, rt = r.right;
    const fwd = rel.x * f.x + rel.z * f.z;
    const lat = rel.x * rt.x + rel.z * rt.z;
    const relSpeed = r.speed - (ball.vel.x * f.x + ball.vel.z * f.z);
    const aimFwd = this.aim.dot(f);
    // Predicted forward offset of ball at mallet contact.
    if (aimFwd > -0.25) {
      const tc = 0.34;
      const atContact = fwd - relSpeed * tc;
      if (Math.abs(atContact) < 0.9) {
        if (lat > 0.65 && lat < 1.75) { r.aimDir.copy(this.aim); r.beginSwing('fore', 1); this.releaseAt = 0.2; }
        else if (lat < -0.65 && lat > -1.75 && this.d.skill > 0.45) { r.aimDir.copy(this.aim); r.beginSwing('fore', -1); this.releaseAt = 0.2; }
      }
    } else {
      // Target is behind us: backhand.
      const tc = 0.3;
      const atContact = fwd - relSpeed * tc;
      if (Math.abs(atContact) < 0.9 && lat > 0.65 && lat < 1.75) { r.aimDir.copy(this.aim); r.beginSwing('back', 1); this.releaseAt = 0.12; }
    }
  }
}

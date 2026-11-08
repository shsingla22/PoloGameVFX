import { Vector3 } from 'three';
import { ARENA, BALL, MATCH, HORSE } from '../config.js';

/**
 * Match flow and simplified Hurlingham/USPA-style arena rules:
 *  - chukkers with a running clock, bell at the end, extra golden-goal chukker on a tie
 *  - teams switch ends after every goal; restart with an umpire throw-in
 *  - line of the ball (LOB) + right of way (ROW); crossing in front of the ROW holder is a foul
 *  - dangerous side-on collisions (vs. legal parallel ride-offs) are a foul
 *  - penalties are free hits; fouls in the defensive third give a penalty from the 25 m spot
 */
export class Match {
  constructor(riders, ball, opts = {}) {
    this.riders = riders;
    this.ball = ball;
    this.opts = { chukkers: MATCH.chukkers, chukkerSeconds: MATCH.chukkerSeconds, ...opts };
    this.listeners = [];
    this.score = [0, 0];
    this.attackDir = [1, -1];       // team 0 attacks +X first
    this.chukker = 1;
    this.clock = this.opts.chukkerSeconds;
    this.state = 'pregame';
    this.stateTime = 0;
    this.time = 0;
    this.overtime = false;
    this.lob = null;               // { origin, dir, holderId, setAt }
    this.prevSide = new Map();
    this.pendingRestart = null;
    this.freeHit = null;           // { teamId, spot }
    this.stats = { hits: [0, 0], fouls: [0, 0] };
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }

  teamOf(id) { return this.riders.find((r) => r.id === id)?.team; }
  goalX(teamId) { return this.attackDir[teamId] * ARENA.length / 2; }       // goal a team attacks
  ownGoalX(teamId) { return -this.goalX(teamId); }

  setState(s, data) {
    this.state = s;
    this.stateTime = 0;
    this.emit('state', { state: s, ...data });
  }

  start() {
    this.setupThrowIn(0, 0);
    this.emit('kickoff', { chukker: this.chukker });
  }

  get inPlay() { return this.state === 'play'; }

  // ---------- Restarts ----------
  setupThrowIn(x, z) {
    // Umpire bowls the ball in from the side between two parallel lines of players.
    x = Math.max(-ARENA.length / 2 + 12, Math.min(ARENA.length / 2 - 12, x));
    z = Math.max(-ARENA.width / 2 + 9, Math.min(ARENA.width / 2 - 9, z));
    const order = { attack: 0, mid: 1, back: 2 };
    for (const r of this.riders) {
      const d = this.attackDir[r.team];
      const k = order[r.role] ?? 0;
      r.place(x - d * (1.8 + (k === 2 ? 0.6 : 0)), z - 2 + k * 2.8, -Math.PI / 2);
      r.stamina = Math.max(r.stamina, 0.6);
    }
    this.ball.reset(x, z - 9, 0.9);
    this.lob = null;
    this.prevSide.clear();
    this.freeHit = null;
    this.throwInSpot = new Vector3(x, 0, z);
    this._bowled = false;
    this.setState('throwin');
  }

  bowlBall() {
    const b = this.ball;
    b.vel.set((Math.random() - 0.5) * 0.8, 1.6, 5.5 + Math.random());
    this.emit('throwin', { pos: b.pos.clone() });
  }

  setupFreeHit(teamId, spot, label) {
    const goalX = this.goalX(teamId);
    const dir = Math.sign(goalX);
    // Defensive-third fouls -> penalty from the spot 25 m out.
    let p = spot.clone();
    const offenderOwnGoal = goalX; // the fouled team attacks the offender's goal
    if (Math.abs(spot.x - offenderOwnGoal) < ARENA.length / 3) {
      p.set(offenderOwnGoal - dir * 25, 0, 0);
      label = `${label} · Penalty 2`;
    } else {
      label = `${label} · Penalty 5`;
    }
    p.x = Math.max(-ARENA.length / 2 + 6, Math.min(ARENA.length / 2 - 6, p.x));
    p.z = Math.max(-ARENA.width / 2 + 4, Math.min(ARENA.width / 2 - 4, p.z));
    this.ball.reset(p.x, p.z);
    const hitter = this.closestOfTeam(teamId, p, true);
    const heading = Math.atan2(-p.z * 0.25, dir);
    const toGoal = new Vector3(goalX - p.x, 0, -p.z).normalize();
    const right = new Vector3(-toGoal.z, 0, toGoal.x);
    for (const r of this.riders) {
      if (r === hitter) {
        // Line up behind the ball with it on the off-side.
        const s = p.clone().addScaledVector(toGoal, -9).addScaledVector(right, -1.2);
        r.place(s.x, s.z, Math.atan2(toGoal.z, toGoal.x));
      } else if (r.team === teamId) {
        const s = p.clone().addScaledVector(toGoal, -14 - Math.random() * 6).addScaledVector(right, (Math.random() - 0.5) * 18);
        r.place(clampX(s.x), clampZ(s.z), heading);
      } else {
        // Defenders must give clearance, goal-side.
        const s = p.clone().addScaledVector(toGoal, MATCH.freeHitClearance + 4 + Math.random() * 10).addScaledVector(right, (Math.random() - 0.5) * 14);
        r.place(clampX(s.x), clampZ(s.z), heading + Math.PI);
      }
    }
    this.freeHit = { teamId, spot: p, hitterId: hitter.id };
    this.lob = null;
    this.prevSide.clear();
    this.emit('freehit', { teamId, label, hitterId: hitter.id });
    this.setState('freehit', { label });
  }

  closestOfTeam(teamId, p, preferPlayer = false) {
    let best = null, bd = Infinity;
    for (const r of this.riders) {
      if (r.team !== teamId) continue;
      let d = r.pos.distanceTo(p);
      if (preferPlayer && r.isPlayer) d -= 15;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // ---------- Per-step ----------
  update(dt) {
    this.time += dt;
    this.stateTime += dt;
    switch (this.state) {
      case 'throwin':
        if (this.stateTime > MATCH.throwInDelay && !this._bowled) { this._bowled = true; this.bowlBall(); this.setState('play'); }
        break;
      case 'freehit':
        if (this.stateTime > 1.2) this.setState('play');
        break;
      case 'goal':
        if (this.stateTime > MATCH.goalCelebration) {
          if (this.overtime) { this.endMatch(); break; }
          // Teams change ends after every goal.
          this.attackDir = [-this.attackDir[0], -this.attackDir[1]];
          this.emit('switchEnds', {});
          this.setupThrowIn(0, 0);
        }
        break;
      case 'foul':
        if (this.stateTime > MATCH.foulDelay) this.setupFreeHit(this.pendingRestart.teamId, this.pendingRestart.spot, this.pendingRestart.label);
        break;
      case 'out':
        if (this.stateTime > 1.6) { this.setupThrowIn(this.pendingRestart.x, this.pendingRestart.z); }
        break;
      case 'break':
        if (this.stateTime > MATCH.breakSeconds) {
          this.chukker++;
          this.clock = this.opts.chukkerSeconds;
          for (const r of this.riders) r.stamina = 1;   // fresh ponies each chukker
          this.setupThrowIn(0, 0);
          this.emit('kickoff', { chukker: this.chukker, overtime: this.overtime });
        }
        break;
    }

    if (this.state === 'play') {
      this.clock -= dt;
      this.updateLineOfBall();
      this.checkCrossing();
      if (this.clock <= 0) {
        this.clock = 0;
        this.emit('bell', { chukker: this.chukker });
        if (this.chukker >= this.opts.chukkers) {
          if (this.score[0] === this.score[1]) {
            this.overtime = true;
            this.emit('overtime', {});
            this.setState('break', { label: 'Extra chukker — golden goal' });
          } else this.endMatch();
        } else this.setState('break', { label: `End of chukker ${this.chukker}` });
      }
    }
  }

  /** Called by the game after ball physics with drained events. */
  handleBallEvents(events) {
    for (const e of events) {
      if (e.type === 'goal' && this.state === 'play') {
        const scorer = this.attackDir[0] === e.side ? 0 : 1;
        this.score[scorer]++;
        const by = this.ball.lastHitBy;
        const own = by != null && this.teamOf(by) !== scorer;
        this.emit('goal', { team: scorer, side: e.side, by, own, pos: e.pos });
        this.setState('goal', { team: scorer });
      } else if (e.type === 'out' && this.state === 'play') {
        this.pendingRestart = { x: e.pos.x * 0.85, z: e.pos.z * 0.6 };
        this.emit('out', { pos: e.pos });
        this.setState('out');
      } else if (e.type === 'board' || e.type === 'bounce' || e.type === 'post') {
        this.emit(e.type, e);
      }
    }
  }

  /** A rider struck the ball. */
  registerHit(rider, shot) {
    this.stats.hits[rider.team]++;
    if (this.state === 'freehit') this.setState('play');
    const dir = shot.dir.clone().setY(0).normalize();
    this.lob = { origin: this.ball.pos.clone().setY(0), dir, holderId: rider.id, setAt: this.time };
    this.prevSide.clear();
  }

  updateLineOfBall() {
    const lob = this.lob;
    if (!lob) return;
    const b = this.ball;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    // The line follows the ball's current direction of travel.
    if (hs > 1.5) {
      lob.dir.set(b.vel.x / hs, 0, b.vel.z / hs);
      lob.origin.set(b.pos.x, 0, b.pos.z);
    }
    const holder = this.riders.find((r) => r.id === lob.holderId);
    if (!holder) { this.lob = null; return; }
    // Holder keeps ROW while following the line closely; otherwise it lapses.
    const toBall = new Vector3(b.pos.x - holder.pos.x, 0, b.pos.z - holder.pos.z);
    const following = holder.forward.dot(lob.dir) > 0.45 && toBall.length() < 30;
    if (!following && this.time - lob.setAt > 1.2) this.lob = null;
  }

  checkCrossing() {
    const lob = this.lob;
    if (!lob) return;
    const holder = this.riders.find((r) => r.id === lob.holderId);
    if (!holder || holder.speed < 4.5) return;
    const holderLat = lateral(lob, holder.pos);
    if (Math.abs(holderLat) > 3.5) return;
    for (const o of this.riders) {
      if (o.team === holder.team) continue;
      const lat = lateral(lob, o.pos);
      const prev = this.prevSide.get(o.id);
      this.prevSide.set(o.id, lat);
      if (prev === undefined || Math.sign(prev) === Math.sign(lat) || o.foulCooldown > 0) continue;
      const ahead = new Vector3().subVectors(o.pos, holder.pos).dot(lob.dir);
      // Crossing (cutting across, not meeting head-on or riding alongside) close in
      // front of the right-of-way holder is dangerous.
      const across = Math.abs(o.forward.dot(lob.dir)) < 0.72;
      if (across && ahead > 0.5 && ahead < 9 && o.speed > 3.5) {
        o.foulCooldown = 3;
        this.callFoul(o, holder, 'Crossing the line', o.pos.clone());
        return;
      }
    }
  }

  /** Called by the game when two ponies collide. */
  registerContact(a, b, relSpeed) {
    if (this.state !== 'play' || a.team === b.team) return;
    const angle = Math.acos(Math.max(-1, Math.min(1, a.forward.dot(b.forward))));
    if (angle < Math.PI / 4) {
      // Shoulder-to-shoulder at matching speed: a legal ride-off.
      if (relSpeed > 0.5) this.emit('rideoff', { a: a.id, b: b.id, pos: a.pos.clone().lerp(b.pos, 0.5) });
      return;
    }
    if (relSpeed < 7.5) return;
    // Side-on collision at speed: the one not holding the line is penalised.
    let offender = a, victim = b;
    if (this.lob && this.lob.holderId === a.id) { offender = b; victim = a; }
    else if (!this.lob || this.lob.holderId !== b.id) {
      // No ROW: whoever charged in faster commits the foul.
      if (b.speed > a.speed) { offender = b; victim = a; }
    }
    if (offender.foulCooldown > 0) return;
    offender.foulCooldown = 3;
    this.callFoul(offender, victim, 'Dangerous riding', offender.pos.clone());
  }

  callFoul(offender, victim, reason, spot) {
    this.stats.fouls[offender.team]++;
    const label = `Foul: ${reason}`;
    this.pendingRestart = { teamId: victim.team, spot, label };
    this.emit('foul', { offender: offender.id, victim: victim.id, reason, label, spot });
    this.setState('foul', { label });
  }

  endMatch() {
    const winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.emit('fulltime', { score: [...this.score], winner });
    this.setState('fulltime');
  }
}

export function lateral(lob, p) {
  // Signed distance of p from the line of the ball (cross product, y-component).
  const dx = p.x - lob.origin.x, dz = p.z - lob.origin.z;
  return lob.dir.x * dz - lob.dir.z * dx;
}

const clampX = (x) => Math.max(-ARENA.length / 2 + 3, Math.min(ARENA.length / 2 - 3, x));
const clampZ = (z) => Math.max(-ARENA.width / 2 + 3, Math.min(ARENA.width / 2 - 3, z));

/** Keep a rider inside the boards (soft wall). */
export function confineRider(r) {
  const hx = ARENA.length / 2 - HORSE.radius, hz = ARENA.width / 2 - HORSE.radius;
  let hit = false;
  if (Math.abs(r.pos.x) > hx) { r.pos.x = Math.sign(r.pos.x) * hx; hit = true; }
  if (Math.abs(r.pos.z) > hz) { r.pos.z = Math.sign(r.pos.z) * hz; hit = true; }
  if (hit) r.speed *= 0.97;
  return hit;
}

export { BALL };

import * as THREE from 'three';
import { ARENA, BALL, GAITS, HORSE, MALLET, SIM_DT, TEAMS, DIFFICULTY } from '../config.js';
import { BallPhysics } from './ball.js';
import { Rider } from './rider.js';
import { Match, confineRider } from './rules.js';
import { Brain } from './ai.js';
import { HorseModel, MalletModel } from '../entities/horseModel.js';

const ROSTER = [
  { team: 0, number: 1, role: 'attack' }, { team: 0, number: 2, role: 'mid', isPlayer: true }, { team: 0, number: 3, role: 'back' },
  { team: 1, number: 1, role: 'attack' }, { team: 1, number: 2, role: 'mid' }, { team: 1, number: 3, role: 'back' },
];

export class Game {
  constructor({ scene, camera, arena, vfx, audio, hud, input, xr, opts }) {
    Object.assign(this, { scene, camera, arena, vfx, audio, hud, input, xr });
    this.opts = opts;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.club;
    this.cameraModes = ['Chase', 'Rider', 'TV'];
    this.cameraMode = 'Chase';
    this.shake = 0;
    this.acc = 0;
    this.time = 0;
    this.paused = false;
    this.vrMessage = '';
    this.contactTimers = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.ball = new BallPhysics();
    this.riders = ROSTER.map((d, i) => new Rider({ id: i, ...d }));
    this.player = this.riders.find((r) => r.isPlayer);
    this.player.hitRadiusBonus = 0.32;
    this.brains = this.riders.filter((r) => !r.isPlayer).map((r) => {
      // Your own teammates play one notch better than the opposition at Novice.
      const d = r.team === 0 && opts.difficulty === 'novice' ? DIFFICULTY.club : this.diff;
      return new Brain(r, d);
    });
    this.models = this.riders.map((r, i) => {
      const m = new HorseModel({ team: TEAMS[r.team], number: r.number, coatIndex: i * 2 + r.team });
      this.group.add(m.root);
      return m;
    });
    this.playerModel = this.models[this.player.id];
    this.mallets = this.riders.map((r, i) => { const m = new MalletModel(this.models[i].rightArmMat); this.group.add(m.group); return m; });

    // Mounted umpire in stripes.
    this.umpire = new Rider({ id: 99, team: 0, number: 0, role: 'ump' });
    this.umpireModel = new HorseModel({ team: { ...TEAMS[0], accent: 0x111111 }, number: null, coatIndex: 3, umpire: true });
    this.group.add(this.umpireModel.root);

    // Ball + ground marker
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x222222 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 18, 12), ballMat);
    this.ballMesh.castShadow = true;
    this.group.add(this.ballMesh);
    this.ballMarker = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballMarker.rotation.x = -Math.PI / 2;
    this.group.add(this.ballMarker);
    // Aim chevron for the player
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9); shape.lineTo(0.35, 0); shape.lineTo(0.12, 0.08); shape.lineTo(0, 0.5); shape.lineTo(-0.12, 0.08); shape.lineTo(-0.35, 0);
    this.aimArrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.aimArrow.rotation.x = -Math.PI / 2;
    this.group.add(this.aimArrow);

    this.match = new Match(this.riders, this.ball, { chukkers: opts.chukkers, chukkerSeconds: opts.chukkerSeconds });
    this.match.on((t, d) => this.onMatchEvent(t, d));
    this.vfx.onFirework = (p) => this.audio.boom(p);
    this.camPos = new THREE.Vector3(-20, 8, 0);
    this.camLook = new THREE.Vector3();
  }

  start() {
    this.match.start();
    this.umpire.place(0, -ARENA.width / 2 + 4, Math.PI / 2);
    this.vfx.trail.reset(this.ball.pos);
    this.camPos.copy(this.player.pos).add(new THREE.Vector3(-8, 4, 0));
  }

  dispose() { this.scene.remove(this.group); }

  name(id) {
    const r = this.riders.find((q) => q.id === id);
    if (!r) return '';
    return r.isPlayer ? 'You' : `${TEAMS[r.team].short} #${r.number}`;
  }

  // ---------------- Events ----------------
  onMatchEvent(type, d) {
    const hud = this.hud, a = this.audio;
    switch (type) {
      case 'goal': {
        const t = TEAMS[d.team];
        const gx = d.side * ARENA.length / 2;
        this.vfx.goal(new THREE.Vector3(gx, 0, d.pos.z), d.side, t.color, t.accent);
        this.arena.excitement = 1.4;
        this.arena.goalNet(d.side, 1);
        a.cheer(d.team === 0 ? 1 : 0.6, 5);
        a.whistle(true);
        const scorer = d.by != null ? this.name(d.by) : '';
        const mine = d.by === this.player.id && !d.own;
        hud.toast(mine ? 'GOAL! YOU SCORED!' : `GOAL — ${t.name}`, d.own ? `Own goal by ${scorer}` : scorer ? `Scored by ${scorer}` : '', 3.5, 'goal');
        hud.log(`⚑ Goal ${t.short} (${this.match.score[0]}–${this.match.score[1]})`, '#ffd34d');
        this.vrMessage = `GOAL ${t.short}!`;
        if (this.xr?.active) { this.xr.pulse('right', 1, 200); this.xr.pulse('left', 1, 200); }
        this.arena.drawScoreboard(this.match.score, this.match.chukker, this.match.clock);
        break;
      }
      case 'foul': {
        a.whistle(true);
        const who = this.name(d.offender);
        hud.toast(d.label.toUpperCase(), `${who} — free hit to ${TEAMS[this.riders[d.victim].team].name}`, 2.6, 'foul');
        hud.log(`✖ ${who}: ${d.reason}`, '#ff8a7a');
        this.vrMessage = `Foul: ${d.reason}`;
        break;
      }
      case 'freehit':
        hud.toast(d.label.split('·')[1]?.trim().toUpperCase() || 'FREE HIT', `${this.name(d.hitterId)} to take it`, 1.8);
        a.whistle(false);
        break;
      case 'out':
        a.whistle(false);
        hud.toast('OUT OF PLAY', 'Umpire throw-in', 1.6);
        break;
      case 'throwin':
        a.whistle(false);
        this.vrMessage = '';
        break;
      case 'bell':
        a.bell();
        hud.toast(`END OF CHUKKER ${d.chukker}`, 'Change ponies', 3);
        break;
      case 'kickoff':
        hud.toast(d.overtime ? 'EXTRA CHUKKER' : `CHUKKER ${d.chukker}`, d.overtime ? 'Golden goal wins' : 'Umpire throw-in', 2.4);
        this.input.gait = 0; if (this.xr) this.xr.gait = 0;
        this.arena.drawScoreboard(this.match.score, this.match.chukker, this.match.clock);
        break;
      case 'switchEnds':
        hud.log('↔ Teams change ends', '#9fd');
        break;
      case 'rideoff':
        this.vfx.rideoff(d.pos);
        a.thud(d.pos, 4, false);
        if (d.a === this.player.id || d.b === this.player.id) { hud.log('Ride-off!', '#cfe'); if (this.xr?.active) this.xr.pulse('left', 0.6, 120); this.shake = Math.max(this.shake, 0.2); }
        break;
      case 'board':
        this.vfx.board(d.pos, d.speed); a.thud(d.pos, d.speed, true);
        if (Math.abs(d.pos.x) > ARENA.length / 2 - 1 && Math.abs(d.pos.z) < ARENA.goalWidth / 2 + 3 && d.speed > 8) a.ooh();
        break;
      case 'post':
        this.vfx.board(d.pos, d.speed); a.thud(d.pos, d.speed, true); a.ooh();
        hud.log('Off the post!', '#fff');
        break;
      case 'bounce':
        this.vfx.bounce(d.pos, d.speed);
        break;
      case 'fulltime':
        a.whistle(true); a.cheer(1, 6);
        this.onFulltime && this.onFulltime(d, this.match.stats);
        break;
    }
  }

  onMalletGround(p) {
    this.vfx.turf.spawn(p.x, 0.05, p.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 0.8, 0.06, 0.05, 0.25, 0.32, 0.15, 1, 9.8, 0.3);
    this.vfx.decals.add(p.x, p.z, 0.3, 0.4, Math.random() * 3);
  }

  // ---------------- Player control ----------------
  applyPlayerInput(dt) {
    const p = this.player, inp = this.input, st = this.match.state;
    const vr = this.xr?.active;
    for (const e of inp.drain()) {
      if (e === 'camera') this.cameraMode = this.cameraModes[(this.cameraModes.indexOf(this.cameraMode) + 1) % this.cameraModes.length];
      else if (e === 'pause') this.onPause && this.onPause();
      else if (e === 'mute') this.onMute && this.onMute();
      else if (e === 'help') this.onHelp && this.onHelp();
      else if (e.startsWith('swingStart') && !vr) {
        const kind = e.split(':')[1];
        if (p.beginSwing(kind, kind === 'fore' && inp.nearSide ? -1 : 1)) this.audio.swish(p.pos, 0.4);
      } else if (e === 'swingRelease' && !vr) p.releaseSwing();
    }
    if (p.swing.state === 'windup' && p.swing.t > 0.95) p.releaseSwing();

    const frozen = st === 'throwin' || (st === 'freehit' && this.match.freeHit?.hitterId !== p.id) || st === 'fulltime';
    const gait = vr ? this.xr.gait : inp.gait;
    if (vr) inp.gait = gait;
    p.desiredSpeed = frozen ? 0 : GAITS[gait].speed;
    p.sprint = !frozen && (vr ? this.xr.sprint : inp.sprint) && gait >= 3;
    if (p.sprint) p.desiredSpeed = HORSE.sprintSpeed;
    p.steer = frozen ? 0 : vr ? this.xr.steer : inp.steer;
    p.targetHeading = null;

    // Aim: forehand follows heading (+ mouse offset); assist bends toward goal when roughly facing it.
    const fwd = p.forward;
    const kind = p.swing.kind;
    const base = kind === 'back' && !vr ? Math.atan2(-fwd.z, -fwd.x) - inp.aimOffset : Math.atan2(fwd.z, fwd.x) + inp.aimOffset;
    const aim = new THREE.Vector3(Math.cos(base), 0, Math.sin(base));
    const gx = this.match.goalX(p.team);
    const toGoal = new THREE.Vector3(gx - this.ball.pos.x, 0, -this.ball.pos.z).normalize();
    if (aim.dot(toGoal) > Math.cos(0.6)) aim.lerp(toGoal, 0.6).normalize();
    if (!vr) { p.aimDir.copy(aim); p.aimBlend = 0.85; }
    else p.aimDir.copy(toGoal);
    this.aimVec = aim;
  }

  // ---------------- Simulation ----------------
  step(dt) {
    const ctx = { match: this.match, ball: this.ball, riders: this.riders, time: this.time };
    for (const b of this.brains) b.update(dt, ctx);
    for (const r of this.riders) {
      r.update(dt);
      confineRider(r);
      for (const leg of r.footfalls) {
        const f = r.forward, rt = r.right;
        const lx = leg % 2 === 0 ? 0.2 : -0.2, lz = leg < 2 ? 0.7 : -0.65;
        const x = r.pos.x + f.x * lz - rt.x * lx, z = r.pos.z + f.z * lz - rt.z * lx;
        this.vfx.hoof(x, z, r.speed, f.x, f.z);
        if (leg === 0 || leg === 3 || r.speed < 9) this.audio.hoof({ x, y: 0, z }, r.speed);
      }
    }
    this.collideRiders(dt);
    this.updateUmpire(dt);

    if (this.match.state !== 'throwin') {
      this.ball.step(dt);
      this.collideBallHorses();
    } else {
      // Ball sits in the umpire's hand until bowled.
      const u = this.umpire;
      this.ball.pos.set(u.pos.x + u.forward.x * 0.7, 2.0, u.pos.z + u.forward.z * 0.7);
      this.ball.vel.set(0, 0, 0);
    }
    this.match.handleBallEvents(this.ball.drainEvents());

    // Mallet strikes
    const st = this.match.state;
    if (st === 'play' || st === 'freehit') {
      for (const r of this.riders) {
        if (st === 'freehit' && this.match.freeHit?.hitterId !== r.id) continue;
        const shot = r.testHit(this.ball, BALL.radius, this.time);
        if (!shot) continue;
        this.ball.strike(shot.dir, shot.speed, shot.loft, r.id, this.time);
        this.match.registerHit(r, shot);
        this.vfx.hit(this.ball.pos, shot.dir, shot.speed, r.team === 0 ? 0xcfe0ff : 0xffe0c0);
        this.audio.mallet(this.ball.pos, shot.speed);
        this.arena.excitement = Math.min(1.2, this.arena.excitement + 0.08 + shot.speed / 200);
        if (r.isPlayer) {
          this.shake = Math.max(this.shake, 0.15 + shot.speed / 120);
          if (this.xr?.active) this.xr.pulse('right', Math.min(1, 0.3 + shot.speed / 30), 70);
        }
        break;
      }
    }
    this.match.update(dt);
    this.time += dt;
  }

  /** Ponies as two circles (forequarters, hindquarters): allows tight ride-offs. */
  collideRiders(dt) {
    const rs = this.riders;
    const R = 0.52;
    for (const [k, v] of this.contactTimers) { if (v > 0) this.contactTimers.set(k, v - dt); }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (Math.abs(a.pos.x - b.pos.x) > 4 || Math.abs(a.pos.z - b.pos.z) > 4) continue;
      const fa = a.forward, fb = b.forward;
      let best = null;
      for (const oa of [0.6, -0.6]) for (const ob of [0.6, -0.6]) {
        const ax = a.pos.x + fa.x * oa, az = a.pos.z + fa.z * oa;
        const bx = b.pos.x + fb.x * ob, bz = b.pos.z + fb.z * ob;
        const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
        const pen = 2 * R - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0 };
      }
      if (!best) continue;
      const push = best.pen * 0.5;
      a.pos.x -= best.nx * push; a.pos.z -= best.nz * push;
      b.pos.x += best.nx * push; b.pos.z += best.nz * push;
      const rel = (a.vel.x - b.vel.x) * best.nx + (a.vel.z - b.vel.z) * best.nz;
      if (rel > 0) { a.speed *= 0.985; b.speed *= 0.985; }
      const key = i * 10 + j;
      if (!(this.contactTimers.get(key) > 0)) {
        this.contactTimers.set(key, 0.8);
        const relSpeed = Math.hypot(a.vel.x - b.vel.x, a.vel.z - b.vel.z);
        this.match.registerContact(a, b, relSpeed);
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
    const u = this.umpire, b = this.ball.pos;
    let tx, tz;
    if (this.match.state === 'throwin') { const s = this.match.throwInSpot; tx = s.x; tz = s.z - 11; }
    else { tx = b.x - Math.sign(b.x || 1) * 8; tz = b.z > 0 ? b.z - 12 : b.z + 12; }
    const dx = tx - u.pos.x, dz = tz - u.pos.z, d = Math.hypot(dx, dz);
    if (this.match.state === 'throwin' && d < 2) {
      u.targetHeading = Math.PI / 2; u.desiredSpeed = 0;
    } else {
      u.targetHeading = Math.atan2(dz, dx);
      u.desiredSpeed = Math.min(GAITS[4].speed, d * 0.8);
    }
    if (this.match.state === 'throwin' && this.match.stateTime < 0.05) u.place(tx, tz, Math.PI / 2);
    u.update(dt);
    confineRider(u);
  }

  // ---------------- Frame ----------------
  update(frameDt) {
    const dt = Math.min(frameDt, 0.1);
    if (this.xr?.active) this.xr.update(dt, this);
    if (this.paused) return;
    this.input.poll(dt);
    this.applyPlayerInput(dt);
    this.acc += dt;
    let n = 0;
    while (this.acc >= SIM_DT && n < 16) { this.step(SIM_DT); this.acc -= SIM_DT; n++; }
    this.render(dt);
  }

  render(dt) {
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      this.models[i].update(r, dt);
      this.mallets[i].update(r, true, this.models[i].body.position.y);
    }
    this.umpireModel.update(this.umpire, dt);
    // Ball
    this.ballMesh.position.copy(this.ball.pos);
    const sp = this.ball.spin, sl = sp.length();
    if (sl > 0) this.ballMesh.rotateOnWorldAxis(sp.clone().divideScalar(sl), sl * dt);
    this.ballMarker.position.set(this.ball.pos.x, 0.02, this.ball.pos.z);
    const camD = this.camera.getWorldPosition(new THREE.Vector3()).distanceTo(this.ball.pos);
    this.ballMarker.scale.setScalar(Math.max(0.5, camD / 18));
    this.ballMarker.material.opacity = Math.min(0.45, camD / 60);
    // Aim chevron (desktop)
    const p = this.player;
    const near = p.pos.distanceTo(this.ball.pos) < 12 && !this.xr?.active && this.aimVec;
    this.aimArrow.visible = !!near;
    if (near) {
      this.aimArrow.position.set(this.ball.pos.x + this.aimVec.x * 1.2, 0.03, this.ball.pos.z + this.aimVec.z * 1.2);
      this.aimArrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-this.aimVec.x, -this.aimVec.z));
    }
    if (this.match.state === 'play' && Math.floor(this.match.clock * 4) !== this._lastClockQ) {
      this._lastClockQ = Math.floor(this.match.clock * 4);
      if (this._lastClockQ % 4 === 0) this.arena.drawScoreboard(this.match.score, this.match.chukker, this.match.clock);
    }
    if (!this.xr?.active) this.updateCamera(dt);
    this.arena.focusShadows(this.player.pos.clone().lerp(this.ball.pos, 0.4));
    this.arena.update(dt);
    this.vfx.update(dt, this.camera, this.ball);
    // Hide own body in VR so the player isn't inside their own helmet.
    this.playerModel.torsoG.visible = !this.xr?.active;
    this.mallets[p.id].group.visible = !this.xr?.active;
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    this.audio.setListener(cam, fwd, new THREE.Vector3(0, 1, 0));
    this.hud.update(dt, this);
  }

  updateCamera(dt) {
    const p = this.player, f = p.forward, b = this.ball.pos;
    const cam = this.camera;
    let want, look;
    if (this.cameraMode === 'Rider') {
      want = p.pos.clone().add(new THREE.Vector3(0, HORSE.eyeHeight + this.playerModel.body.position.y, 0)).addScaledVector(f, 0.15);
      look = want.clone().addScaledVector(f, 10).add(new THREE.Vector3(0, -1.6, 0));
      cam.position.copy(want);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 12));
      cam.lookAt(this.camLook);
      this.playerModel.torsoG.visible = false;
    } else if (this.cameraMode === 'TV') {
      want = new THREE.Vector3(b.x * 0.85, 16, -ARENA.width / 2 - 14);
      look = new THREE.Vector3(b.x, 0, b.z * 0.6);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 2));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
    } else {
      // Chase cam that leans toward the ball when it's near.
      const toBall = new THREE.Vector3(b.x - p.pos.x, 0, b.z - p.pos.z);
      const dist = toBall.length();
      const w = dist < 35 ? 0.35 * (1 - dist / 35) : 0;
      const dir = f.clone().lerp(toBall.normalize(), w).normalize();
      const back = 7.2 + p.speed * 0.12;
      want = p.pos.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, 3.4 + p.speed * 0.03, 0));
      look = p.pos.clone().addScaledVector(dir, 7).add(new THREE.Vector3(0, 1.2, 0));
      this.camPos.lerp(want, 1 - Math.exp(-dt * 5));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 7));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
    }
    // Camera shake (desktop only; never in VR).
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * 0.12;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    // Subtle FOV kick at a flat-out gallop.
    const fov = 62 + Math.max(0, p.speed - 10) * 0.9;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
  }
}

export { MALLET };

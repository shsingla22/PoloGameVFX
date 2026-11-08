import * as THREE from 'three';
import { ARENA, BALL, GAITS, HORSE, SIM_DT, TEAMS } from '../config.js';
import { Sim } from './sim.js';
import { HorseModel, MalletModel } from '../entities/horseModel.js';

/**
 * Visual / audio / input layer over the rendering-free Sim.
 */
export class Game {
  constructor({ scene, camera, arena, vfx, audio, hud, input, xr, opts }) {
    Object.assign(this, { scene, camera, arena, vfx, audio, hud, input, xr });
    this.opts = opts;
    this.cameraModes = ['Chase', 'Rider', 'TV'];
    this.cameraMode = 'Chase';
    this.shake = 0;
    this.acc = 0;
    this.paused = false;
    this.vrMessage = '';
    this.swingAssist = opts.swingAssist !== false;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.sim = new Sim({
      difficulty: opts.difficulty, chukkers: opts.chukkers, chukkerSeconds: opts.chukkerSeconds, playerIsAI: !!opts.demo,
      hooks: {
        footfall: (r, leg) => this.onFootfall(r, leg),
        hit: (r, shot) => this.onHit(r, shot),
      },
    });
    this.ball = this.sim.ball;
    this.riders = this.sim.riders;
    this.player = this.sim.player;
    this.match = this.sim.match;
    this.umpire = this.sim.umpire;

    this.models = this.riders.map((r, i) => {
      const m = new HorseModel({ team: TEAMS[r.team], number: r.number, coatIndex: i * 2 + r.team, quality: opts.quality });
      this.group.add(m.root);
      return m;
    });
    this.playerModel = this.models[this.player.id];
    this.mallets = this.riders.map((r, i) => { const m = new MalletModel(this.models[i]); this.group.add(m.group); return m; });
    this.umpireModel = new HorseModel({ team: { ...TEAMS[0], accent: 0x111111 }, number: null, coatIndex: 3, umpire: true, quality: opts.quality });
    this.group.add(this.umpireModel.root);

    // Ball: slightly glossy inflated arena ball.
    const ballMat = new THREE.MeshPhysicalMaterial({ color: 0xf8f6f0, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 24, 16), ballMat);
    this.ballMesh.castShadow = true;
    this.group.add(this.ballMesh);
    // Ground ring under the ball: turns green when the ball is in your strike lane.
    this.ballMarker = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballMarker.rotation.x = -Math.PI / 2;
    this.ballMarker.renderOrder = 4;
    this.group.add(this.ballMarker);
    // Aim chevron
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9); shape.lineTo(0.35, 0); shape.lineTo(0.12, 0.08); shape.lineTo(0, 0.5); shape.lineTo(-0.12, 0.08); shape.lineTo(-0.35, 0);
    this.aimArrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.aimArrow.renderOrder = 4;
    this.group.add(this.aimArrow);
    // Line of the ball overlay (shows the right-of-way path you must not cross).
    this.lobMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(1, 0.85, 0.3) }, uTime: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uTime; uniform float uAlpha;
        void main(){ float dash = step(0.55, fract(vUv.x * 30.0 - uTime * 3.0));
          float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float a = dash * smoothstep(0.0, 0.4, edge) * (1.0 - vUv.x) * uAlpha;
          gl_FragColor = vec4(uColor, a); }`,
    });
    const lg = new THREE.PlaneGeometry(22, 0.16); lg.translate(11, 0, 0); lg.rotateX(-Math.PI / 2);
    this.lobMesh = new THREE.Mesh(lg, this.lobMat);
    this.lobMesh.renderOrder = 3;
    this.group.add(this.lobMesh);

    this.match.on((t, d) => this.onMatchEvent(t, d));
    this.vfx.onFirework = (p) => this.audio.boom(p);
    this.camPos = new THREE.Vector3(-20, 8, 0);
    this.camLook = new THREE.Vector3();
    this.goalCam = null;
  }

  get time() { return this.sim.time; }

  start() {
    this.sim.start();
    this.vfx.trail.reset(this.ball.pos);
    this.camPos.copy(this.player.pos).add(new THREE.Vector3(-8, 4, 0));
  }

  dispose() { this.scene.remove(this.group); }

  name(id) {
    const r = this.riders.find((q) => q.id === id);
    if (!r) return '';
    return r.isPlayer ? 'You' : `${TEAMS[r.team].short} #${r.number}`;
  }

  // ---------------- Sim hooks ----------------
  onFootfall(r, leg) {
    const f = r.forward, rt = r.right;
    const lx = leg % 2 === 0 ? 0.2 : -0.2, lz = leg < 2 ? 0.7 : -0.65;
    const x = r.pos.x + f.x * lz - rt.x * lx, z = r.pos.z + f.z * lz - rt.z * lx;
    this.vfx.hoof(x, z, r.speed, f.x, f.z);
    if (leg === 0 || leg === 3 || r.speed < 9) this.audio.hoof({ x, y: 0, z }, r.speed);
  }

  onHit(r, shot) {
    this.vfx.hit(this.ball.pos, shot.dir, shot.speed, 0xfff1d6);
    this.audio.mallet(this.ball.pos, shot.speed);
    this.arena.excitement = Math.min(1.2, this.arena.excitement + 0.08 + shot.speed / 200);
    if (r.isPlayer) {
      this.shake = Math.max(this.shake, 0.15 + shot.speed / 120);
      if (this.xr?.active) this.xr.pulse('right', Math.min(1, 0.3 + shot.speed / 30), 70);
      const tag = shot.speed > 22 ? 'Big hit!' : shot.speed < 11 ? 'Tap' : 'Good contact';
      this.hud.flash(tag);
    }
  }

  // ---------------- Match events ----------------
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
        // Cinematic goal cam (desktop): swing around the goal mouth.
        this.goalCam = { gx, side: d.side, t: 0, from: this.camera.position.clone() };
        break;
      }
      case 'foul': {
        a.whistle(true);
        const who = this.name(d.offender);
        const youFouled = d.offender === this.player.id;
        const hint = youFouled ? (d.reason.startsWith('Crossing') ? 'Tip: ride parallel to the yellow line — never cut across in front.' : 'Tip: ride-offs must be shoulder to shoulder, not side-on.') : '';
        hud.toast(d.label.toUpperCase(), `${who} — free hit to ${TEAMS[this.riders[d.victim].team].name}`, 2.6, 'foul');
        if (hint) hud.hint(hint);
        hud.log(`✖ ${who}: ${d.reason}`, '#ff8a7a');
        this.vrMessage = `Foul: ${d.reason}`;
        break;
      }
      case 'freehit': {
        const yours = d.hitterId === this.player.id;
        hud.toast(d.label.split('·')[1]?.trim().toUpperCase() || 'FREE HIT', yours ? 'Your hit — opponents must wait until you strike' : `${this.name(d.hitterId)} to take it`, 2.2);
        a.whistle(false);
        if (yours) { this.input.gait = 3; if (this.xr) this.xr.gait = 3; }
        break;
      }
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
        hud.toast(d.overtime ? 'EXTRA CHUKKER' : `CHUKKER ${d.chukker}`, d.overtime ? 'Golden goal wins' : 'Umpire throw-in — hold W to go', 2.4);
        this.input.gait = 0; if (this.xr) this.xr.gait = 0;
        this.arena.drawScoreboard(this.match.score, this.match.chukker, this.match.clock);
        break;
      case 'switchEnds':
        hud.log('↔ Teams change ends', '#9fd');
        hud.toast('CHANGE ENDS', `You now attack the ${this.match.goalX(0) > 0 ? 'east' : 'west'} goal`, 1.8);
        break;
      case 'rideoff':
        this.vfx.rideoff(d.pos);
        a.thud(d.pos, 4, false);
        if (d.a === this.player.id || d.b === this.player.id) { hud.flash('Ride-off!'); if (this.xr?.active) this.xr.pulse('left', 0.6, 120); this.shake = Math.max(this.shake, 0.2); }
        break;
      case 'bump':
        a.thud(d.pos, 2, false);
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
      else if (e === 'pass') { this.sim.callForPass(); this.hud.flash('Calling for the ball!'); }
      else if (e.startsWith('swingStart') && !vr) {
        const kind = e.split(':')[1];
        // Auto-pick the side the ball is on when it's close; Q forces near-side otherwise.
        let side = inp.nearSide ? -1 : 1;
        const rel = new THREE.Vector3().subVectors(this.ball.pos, p.pos);
        if (kind === 'fore' && rel.length() < 7) side = rel.dot(p.right) < -0.2 ? -1 : 1;
        if (kind === 'back') side = 1;
        if (p.beginSwing(kind, side)) this.audio.swish(p.pos, 0.4);
      } else if (e === 'swingRelease' && !vr) this.sim.requestRelease(this.swingAssist);
    }
    if (p.swing.state === 'windup' && p.swing.t > 1.1 && !this.sim.pendingRelease) this.sim.requestRelease(this.swingAssist);

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
    const toGoal = new THREE.Vector3(gx - this.ball.pos.x, 0, -this.ball.pos.z * 0.8).normalize();
    if (aim.dot(toGoal) > Math.cos(0.6)) aim.lerp(toGoal, 0.6).normalize();
    if (!vr) { p.aimDir.copy(aim); p.aimBlend = 0.85; }
    else p.aimDir.copy(toGoal);
    this.aimVec = aim;
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
    while (this.acc >= SIM_DT && n < 16) { this.sim.step(SIM_DT); this.acc -= SIM_DT; n++; }
    this.render(dt);
  }

  render(dt) {
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      this.models[i].update(r, dt);
      this.mallets[i].update(r, dt);
    }
    this.umpireModel.update(this.umpire, dt);
    const p = this.player, b = this.ball;
    // Ball
    this.ballMesh.position.copy(b.pos);
    const sp = b.spin, sl = sp.length();
    if (sl > 0) this.ballMesh.rotateOnWorldAxis(sp.clone().divideScalar(sl), sl * dt);
    // Strike-lane ring
    const zone = this.match.inPlay || this.match.state === 'freehit' ? this.sim.strikeZone() : 0;
    this.ballMarker.position.set(b.pos.x, 0.025, b.pos.z);
    const camD = this.camera.getWorldPosition(new THREE.Vector3()).distanceTo(b.pos);
    const ringScale = zone === 2 ? 0.75 + Math.sin(this.time * 18) * 0.06 : Math.max(0.5, camD / 18);
    this.ballMarker.scale.setScalar(ringScale);
    this.ballMarker.material.color.setHex(zone === 2 ? 0x5dff8a : zone === 1 ? 0xffe27a : 0xffffff);
    this.ballMarker.material.opacity = zone ? 0.8 : Math.min(0.45, camD / 60);
    // Aim chevron (desktop)
    const near = p.pos.distanceTo(b.pos) < 12 && !this.xr?.active && this.aimVec;
    this.aimArrow.visible = !!near;
    if (near) {
      this.aimArrow.position.set(b.pos.x + this.aimVec.x * 1.2, 0.03, b.pos.z + this.aimVec.z * 1.2);
      this.aimArrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-this.aimVec.x, -this.aimVec.z));
    }
    // Line of the ball overlay
    const lob = this.match.lob;
    const showLob = lob && this.match.inPlay;
    let la = 0;
    if (showLob) {
      this.lobMesh.position.set(b.pos.x, 0.03, b.pos.z);
      this.lobMesh.rotation.y = -Math.atan2(lob.dir.z, lob.dir.x);
      const holder = this.riders.find((r) => r.id === lob.holderId);
      const theirs = holder && holder.team !== p.team;
      this.lobMat.uniforms.uColor.value.setHex(theirs ? 0xff6a4a : 0xffd34d);
      la = theirs ? 0.55 : 0.28;
    }
    this.lobMat.uniforms.uAlpha.value += (la - this.lobMat.uniforms.uAlpha.value) * Math.min(1, dt * 6);
    this.lobMat.uniforms.uTime.value = this.time;
    this.lobMesh.visible = this.lobMat.uniforms.uAlpha.value > 0.02;

    if (this.match.state === 'play' && Math.floor(this.match.clock) !== this._lastClock) {
      this._lastClock = Math.floor(this.match.clock);
      this.arena.drawScoreboard(this.match.score, this.match.chukker, this.match.clock);
    }
    if (!this.xr?.active) this.updateCamera(dt);
    this.arena.focusShadows(this.cameraMode === 'TV' ? b.pos.clone() : p.pos.clone().lerp(b.pos, 0.4));
    this.arena.update(dt, this.camera);
    this.vfx.update(dt, this.camera, b);
    // Hide own body in VR / rider cam so you aren't inside your own helmet.
    const firstPerson = this.xr?.active || this.cameraMode === 'Rider';
    this.playerModel.setFirstPerson(firstPerson);
    this.mallets[p.id].group.visible = !this.xr?.active;
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    this.audio.setListener(cam, fwd, new THREE.Vector3(0, 1, 0));
    this.hud.update(dt, this);
  }

  /** Screen-space direction to the ball when it is off-screen (for the HUD pointer). */
  ballPointer() {
    const v = this.ball.pos.clone().project(this.camera);
    const behind = v.z > 1;
    if (!behind && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.92) return null;
    let x = v.x, y = v.y;
    if (behind) { x = -x; y = -Math.abs(y) - 0.5; }
    return Math.atan2(-y, x);
  }

  updateCamera(dt) {
    const p = this.player, f = p.forward, b = this.ball.pos;
    const cam = this.camera;
    let want, look;
    if (this.goalCam && this.match.state === 'goal') {
      // Low swooping shot of the goal mouth while the crowd celebrates.
      const g = this.goalCam; g.t += dt;
      const a = g.t * 0.35;
      want = new THREE.Vector3(g.gx - g.side * (9 - g.t), 2.2 + g.t * 0.6, Math.sin(a) * 10 - 4);
      look = new THREE.Vector3(g.gx, 1.6, 0);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 3));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.camPos); cam.lookAt(this.camLook);
      return;
    }
    if (this.cameraMode === 'Rider') {
      want = p.pos.clone().add(new THREE.Vector3(0, HORSE.eyeHeight + this.playerModel.body.position.y, 0)).addScaledVector(f, 0.05);
      look = want.clone().addScaledVector(f, 10).add(new THREE.Vector3(0, -1.9, 0));
      // Glance toward the ball when it's to the side.
      const toBall = new THREE.Vector3(b.x - p.pos.x, 0, b.z - p.pos.z);
      if (toBall.length() < 25) look.lerp(new THREE.Vector3(b.x, 0.3, b.z), 0.35);
      cam.position.copy(want);
      this.camLook.lerp(look, 1 - Math.exp(-dt * 8));
      cam.lookAt(this.camLook);
    } else if (this.cameraMode === 'TV') {
      want = new THREE.Vector3(b.x * 0.85, 12.5, -ARENA.width / 2 - 2.5);   // gantry above the boards, in front of the stand
      look = new THREE.Vector3(b.x, 0, b.z * 0.6);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 2));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
    } else {
      // Chase cam that swings toward the ball when it's near or behind.
      const toBall = new THREE.Vector3(b.x - p.pos.x, 0, b.z - p.pos.z);
      const dist = toBall.length();
      const w = dist < 40 ? 0.45 * (1 - dist / 40) : 0;
      const dir = f.clone().lerp(toBall.normalize(), w).normalize();
      const back = 7.2 + p.speed * 0.12;
      want = p.pos.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, 3.4 + p.speed * 0.03, 0));
      // Keep the camera inside the stands so it never clips through boards/roofs.
      want.x = THREE.MathUtils.clamp(want.x, -ARENA.length / 2 - 6, ARENA.length / 2 + 6);
      want.z = THREE.MathUtils.clamp(want.z, -ARENA.width / 2 - 4, ARENA.width / 2 + 4);
      look = p.pos.clone().addScaledVector(dir, 7).add(new THREE.Vector3(0, 1.2, 0));
      this.camPos.lerp(want, 1 - Math.exp(-dt * 5));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 7));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * 0.12;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    const fov = 62 + Math.max(0, p.speed - 10) * 0.9;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
  }
}

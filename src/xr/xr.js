import * as THREE from 'three';
import { GAITS, HORSE, MALLET, TEAMS } from '../config.js';

/**
 * Meta Quest / WebXR support.
 *  - The player's real head rides in a "saddle rig" that follows the pony.
 *  - Right controller IS the mallet (1:1 tracked, reach-assisted shaft).
 *  - Left thumbstick: forward/back steps gait, left/right steers. Left grip: sprint.
 *  - Right B / left Y: recentre seat height.  Right A: toggle aim assist.
 *  - Comfort: dynamic tunnel vignette on turns/acceleration, no camera shake, no forced pitch/roll.
 */
export class XRRig {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.active = false;
    this.dolly = new THREE.Group();
    scene.add(this.dolly);
    this.heightOffset = HORSE.eyeHeight - 1.25;   // assume seated until recentred
    this.assist = true;
    this.comfort = 0.8;
    this.vig = 0;
    this.controllers = [];
    this.prevHead = new THREE.Vector3();
    this.head = new THREE.Vector3();
    this.hand = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.prevStick = { up: false, down: false, a: false, b: false, y: false };
    this.gait = 0;
    this.sprint = false;
    this.steer = 0;
    this.lastYaw = 0;
    this.lastSpeed = 0;
    this.groundTouch = false;

    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const ctrl = renderer.xr.getController(i);
      const entry = { grip, ctrl, hand: null, gamepad: null, source: null };
      grip.addEventListener('connected', (e) => { entry.hand = e.data.handedness; entry.gamepad = e.data.gamepad; entry.source = e.data; this.buildHand(entry); });
      grip.addEventListener('disconnected', () => { entry.hand = null; entry.gamepad = null; grip.clear(); });
      this.dolly.add(grip, ctrl);
      this.controllers.push(entry);
    }
    this.dolly.add(camera);
    this.buildVignette();
    this.buildPanel();
    renderer.xr.addEventListener('sessionstart', () => { this.active = true; this.onStart && this.onStart(); });
    renderer.xr.addEventListener('sessionend', () => { this.active = false; this.onEnd && this.onEnd(); });
  }

  buildHand(entry) {
    entry.grip.clear();
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.6 }));
    glove.scale.set(1, 0.8, 1.4);
    entry.grip.add(glove);
    if (entry.hand === 'right') {
      // The mallet: grip wrap + cane shaft + cigar head, angled down from the fist.
      const m = new THREE.Group();
      m.rotation.x = -0.35;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.016, MALLET.vrShaft, 6), new THREE.MeshStandardMaterial({ color: 0xd9c28c, roughness: 0.5 }));
      shaft.rotation.x = -Math.PI / 2; shaft.position.z = -MALLET.vrShaft / 2;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.23, 10), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 }));
      head.rotation.z = Math.PI / 2; head.position.z = -MALLET.vrShaft;
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      wrap.rotation.x = -Math.PI / 2; wrap.position.z = -0.02;
      m.add(shaft, head, wrap);
      entry.grip.add(m);
      entry.malletTip = head;
    } else if (entry.hand === 'left') {
      entry.reinAnchor = new THREE.Object3D();
      entry.reinAnchor.position.set(0, 0, -0.03);
      entry.grip.add(entry.reinAnchor);
    }
  }

  buildVignette() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.vigMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uAmt: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `varying vec2 vUv; uniform float uAmt;
        void main(){ float r = length(vUv-0.5)*2.0; float inner = mix(1.1, 0.42, uAmt);
          float a = smoothstep(inner, inner+0.35, r) * uAmt; gl_FragColor = vec4(0.02,0.03,0.02,a); }`,
    });
    this.vignette = new THREE.Mesh(geo, this.vigMat);
    this.vignette.position.z = -0.3;
    this.vignette.scale.setScalar(0.45);
    this.vignette.renderOrder = 999;
    this.vignette.visible = false;
    this.camera.add(this.vignette);
  }

  buildPanel() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    this.panelCanvas = c; this.panelCtx = c.getContext('2d');
    this.panelTex = new THREE.CanvasTexture(c); this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.156), new THREE.MeshBasicMaterial({ map: this.panelTex, transparent: true, depthTest: false, toneMapped: false }));
    this.panel.renderOrder = 998;
    this.panel.position.set(0, -0.62, -0.75);
    this.panel.rotation.x = -0.6;
    this.panel.visible = false;
    this.dolly.add(this.panel);
    this.panelT = 0;
    // Rein lines
    const rg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    this.reins = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x2b1a10 }));
    this.reins.frustumCulled = false;
    this.reins.visible = false;
    this.scene.add(this.reins);
  }

  drawPanel(game, msg) {
    const g = this.panelCtx, c = this.panelCanvas, m = game.match, p = game.player;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(10,14,18,0.78)';
    g.beginPath(); g.roundRect(4, 4, c.width - 8, c.height - 8, 24); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.font = 'bold 44px Arial';
    g.fillStyle = '#' + TEAMS[0].color.toString(16).padStart(6, '0'); g.fillText(String(m.score[0]), 70, 52);
    g.fillStyle = '#' + TEAMS[1].color.toString(16).padStart(6, '0'); g.fillText(String(m.score[1]), 442, 52);
    g.fillStyle = '#fff'; g.font = 'bold 30px Arial';
    const t = Math.max(0, m.clock);
    g.fillText(`C${m.chukker}  ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, 256, 40);
    g.font = '24px Arial'; g.fillStyle = '#cfe';
    g.fillText(`${GAITS[this.gait].name} · ${(p.speed * 3.6).toFixed(0)} km/h · assist ${this.assist ? 'on' : 'off'}`, 256, 80);
    g.fillStyle = '#333'; g.fillRect(56, 104, 400, 10);
    g.fillStyle = p.stamina < 0.25 ? '#ff5a3c' : '#5fd38d'; g.fillRect(56, 104, 400 * p.stamina, 10);
    if (msg) { g.font = 'bold 26px Arial'; g.fillStyle = '#ffd34d'; g.fillText(msg, 256, 136); }
    this.panelTex.needsUpdate = true;
  }

  pulse(hand, intensity, ms) {
    const e = this.controllers.find((c) => c.hand === hand);
    const act = e?.gamepad?.hapticActuators?.[0] || e?.source?.gamepad?.hapticActuators?.[0];
    if (act && act.pulse) act.pulse(intensity, ms);
  }

  recenter() {
    const y = this.camera.position.y;      // head height in the local-floor space
    this.heightOffset = HORSE.eyeHeight - y;
  }

  /** Read sticks/buttons -> control state. */
  pollInput() {
    this.steer = 0; this.sprint = false;
    for (const e of this.controllers) {
      const gp = e.gamepad || e.source?.gamepad;
      if (!gp) continue;
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
      const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
      if (e.hand === 'left') {
        if (Math.abs(ax) > 0.2) this.steer = Math.sign(ax) * (Math.abs(ax) - 0.2) / 0.8;
        if (ay < -0.65 && !this.prevStick.up) this.gait = Math.min(GAITS.length - 1, this.gait + 1);
        if (ay > 0.65 && !this.prevStick.down) this.gait = Math.max(0, this.gait - 1);
        this.prevStick.up = ay < -0.65; this.prevStick.down = ay > 0.65;
        if (gp.buttons[1]?.pressed) this.sprint = true;            // squeeze
        const y = gp.buttons[5]?.pressed;
        if (y && !this.prevStick.y) this.recenter();
        this.prevStick.y = y;
      } else if (e.hand === 'right') {
        const a = gp.buttons[4]?.pressed, b = gp.buttons[5]?.pressed;
        if (a && !this.prevStick.a) this.assist = !this.assist;
        if (b && !this.prevStick.b) this.recenter();
        this.prevStick.a = a; this.prevStick.b = b;
        if (gp.buttons[0]?.pressed) this.sprint = true;            // trigger also gallops
      }
    }
  }

  /** Called once per rendered frame before simulation. */
  update(dt, game) {
    const r = game.player;
    if (!this.active || !r) return;
    this.pollInput();
    // Seat the rig on the pony.
    const h = r.heading;
    this.dolly.position.set(r.pos.x, this.heightOffset, r.pos.z);
    this.dolly.rotation.set(0, Math.atan2(-Math.cos(h), -Math.sin(h)), 0);
    this.dolly.updateMatrixWorld(true);

    // Mallet head from the right controller.
    const right = this.controllers.find((c) => c.hand === 'right');
    if (right && right.malletTip) {
      this.prevHead.copy(this.head);
      right.malletTip.getWorldPosition(this.head);
      right.grip.getWorldPosition(this.hand);
      if (this.head.y < MALLET.headRadius * 0.5) {
        this.head.y = MALLET.headRadius * 0.5;
        if (!this.groundTouch) { this.pulse('right', 0.25, 30); game.onMalletGround(this.head); }
        this.groundTouch = true;
      } else this.groundTouch = false;
      if (dt > 0) this.headVel.subVectors(this.head, this.prevHead).divideScalar(dt);
      r.vrMallet = r.vrMallet || { head: new THREE.Vector3(), hand: new THREE.Vector3() };
      r.vrMallet.head.copy(this.head);
      r.vrMallet.hand.copy(this.hand);
      r.prevHead.copy(this.prevHead);
      r.head.copy(this.head);
      r.headVel.copy(this.headVel);
      r.aimBlend = this.assist ? 0.45 : 0;
    }

    // Reins from the left hand to the bit.
    const left = this.controllers.find((c) => c.hand === 'left');
    if (left && left.reinAnchor) {
      const a = left.reinAnchor.getWorldPosition(new THREE.Vector3());
      const bit = game.playerModel.head.localToWorld(new THREE.Vector3(0, 0.42, 0));
      const arr = this.reins.geometry.attributes.position.array;
      const side = r.right.multiplyScalar(0.09);
      const mid1 = new THREE.Vector3().lerpVectors(a, bit, 0.5).add(new THREE.Vector3(0, -0.08, 0));
      const pts = [a, mid1, mid1, bit.clone().add(side), a, bit.clone().sub(side)];
      pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
      this.reins.geometry.attributes.position.needsUpdate = true;
      this.reins.visible = true;
    }

    // Comfort tunnel vignette: scale with yaw rate and acceleration.
    const yaw = Math.abs(r.yawRate);
    const acc = Math.abs(r.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = r.speed;
    const target = Math.min(1, (Math.max(0, yaw - 0.25) * 0.9 + Math.max(0, acc - 2) * 0.05) * this.comfort);
    this.vig += (target - this.vig) * Math.min(1, dt * 6);
    this.vigMat.uniforms.uAmt.value = this.vig;
    this.vignette.visible = this.vig > 0.02;

    this.panelT -= dt;
    if (this.panelT <= 0) { this.panelT = 0.2; this.drawPanel(game, game.vrMessage); }
  }

  setVisible(v) {
    this.panel.visible = v;
    this.reins.visible = v && this.reins.visible;
  }
}

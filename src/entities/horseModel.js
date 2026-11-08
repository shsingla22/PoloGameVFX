import * as THREE from 'three';
import { legOffsets } from '../game/rider.js';

// Coat palettes typical of polo ponies (mostly Thoroughbred-type).
const COATS = [
  { body: 0x5a3220, legs: 0x1c120c, name: 'bay' },
  { body: 0x7a3f1d, legs: 0x5a2c12, name: 'chestnut' },
  { body: 0x2a1a12, legs: 0x140c08, name: 'dark bay' },
  { body: 0x8d8a86, legs: 0x4a4744, name: 'grey' },
  { body: 0x6b4a2f, legs: 0x201510, name: 'brown' },
];

const geoCache = {};
function geo(key, make) { return geoCache[key] || (geoCache[key] = make()); }

function mat(color, rough = 0.7, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function jerseyTexture(team, number, striped = false) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const col = '#' + team.color.toString(16).padStart(6, '0');
  const acc = '#' + team.accent.toString(16).padStart(6, '0');
  if (striped) {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#111' : '#f4f4f4'; g.fillRect(i * 32, 0, 32, 256); }
  } else {
    g.fillStyle = col; g.fillRect(0, 0, 256, 256);
    g.fillStyle = acc; g.fillRect(0, 108, 256, 14);
    if (number != null) {
      g.font = 'bold 110px Arial Black, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.strokeText(String(number), 64, 180); g.fillText(String(number), 64, 180);
      g.strokeText(String(number), 192, 180); g.fillText(String(number), 192, 180);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tapered(rTop, rBot, len, seg = 8) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1);
  g.translate(0, -len / 2, 0);     // pivot at top
  return g;
}

/**
 * Procedural polo pony with rider. Local +Z is forward, off-side (right) is local −X.
 */
export class HorseModel {
  constructor({ team, number, coatIndex = 0, umpire = false }) {
    this.team = team;
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // bobs/pitches/rolls
    this.root.add(this.body);
    const coat = COATS[coatIndex % COATS.length];
    const coatMat = mat(coat.body, 0.55);
    coatMat.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
    const legMat = mat(coat.legs, 0.6);
    const hoofMat = mat(0x151110, 0.4);
    const wrapMat = mat(umpire ? 0xeeeeee : team.wrap, 0.9);
    const tackMat = mat(0x2b1a10, 0.45);
    const darkMat = mat(0x0b0b0b, 0.3);

    // ---- Torso ----
    const torso = new THREE.Mesh(geo('torso', () => new THREE.CapsuleGeometry(0.37, 1.05, 6, 14)), coatMat);
    torso.rotation.x = Math.PI / 2;
    torso.scale.set(1, 1, 1.12);
    torso.position.set(0, 1.2, 0);
    const chest = new THREE.Mesh(geo('chest', () => new THREE.SphereGeometry(0.41, 14, 10)), coatMat);
    chest.position.set(0, 1.2, 0.6); chest.scale.set(0.95, 1.05, 1);
    const rump = new THREE.Mesh(geo('rump', () => new THREE.SphereGeometry(0.43, 14, 10)), coatMat);
    rump.position.set(0, 1.25, -0.62); rump.scale.set(1.02, 1, 1.05);
    this.body.add(torso, chest, rump);

    // ---- Neck & head (hogged mane, as on polo ponies) ----
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.42, 0.82);
    this.neck.rotation.x = 0.75;
    const neckMesh = new THREE.Mesh(geo('neck', () => { const g = new THREE.CylinderGeometry(0.13, 0.24, 0.85, 10); g.translate(0, 0.42, 0); return g; }), coatMat);
    neckMesh.scale.set(0.8, 1, 1.15);
    this.neck.add(neckMesh);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.82, 0);
    this.head.rotation.x = 1.9;
    const skull = new THREE.Mesh(geo('skull', () => { const g = new THREE.CylinderGeometry(0.075, 0.13, 0.58, 10); g.translate(0, 0.27, 0); return g; }), coatMat);
    skull.scale.set(0.85, 1, 1.25);
    const muzzle = new THREE.Mesh(geo('muzzle', () => new THREE.SphereGeometry(0.085, 10, 8)), legMat);
    muzzle.position.set(0, 0.56, 0); muzzle.scale.set(0.95, 0.8, 1.15);
    const earGeo = geo('ear', () => new THREE.ConeGeometry(0.035, 0.13, 6));
    const earL = new THREE.Mesh(earGeo, coatMat); earL.position.set(0.06, -0.02, -0.08); earL.rotation.x = -2.2;
    const earR = earL.clone(); earR.position.x = -0.06;
    const eyeGeo = geo('eye', () => new THREE.SphereGeometry(0.022, 6, 6));
    const eyeL = new THREE.Mesh(eyeGeo, darkMat); eyeL.position.set(0.1, 0.12, -0.04);
    const eyeR = eyeL.clone(); eyeR.position.x = -0.1;
    const bridle = new THREE.Mesh(geo('bridle', () => new THREE.TorusGeometry(0.11, 0.012, 4, 14)), tackMat);
    bridle.position.set(0, 0.4, 0); bridle.rotation.x = Math.PI / 2; bridle.scale.set(0.95, 1.25, 1);
    this.head.add(skull, muzzle, earL, earR, eyeL, eyeR, bridle);
    this.neck.add(this.head);
    this.body.add(this.neck);

    // ---- Tail: tied up and taped, polo style ----
    const tail = new THREE.Group();
    tail.position.set(0, 1.42, -1.0);
    tail.rotation.x = -2.5;
    const tailClub = new THREE.Mesh(geo('tail', () => { const g = new THREE.CapsuleGeometry(0.06, 0.3, 4, 8); g.translate(0, 0.2, 0); return g; }), legMat);
    const tape = new THREE.Mesh(geo('tape', () => new THREE.CylinderGeometry(0.068, 0.068, 0.07, 8)), wrapMat);
    tape.position.y = 0.22;
    tail.add(tailClub, tape);
    this.body.add(tail);

    // ---- Saddle ----
    const saddle = new THREE.Mesh(geo('saddle', () => new THREE.BoxGeometry(0.5, 0.08, 0.62)), tackMat);
    saddle.position.set(0, 1.585, 0.05);
    const pad = new THREE.Mesh(geo('pad', () => new THREE.BoxGeometry(0.78, 0.03, 0.72)), mat(0xf1efe8, 0.9));
    pad.position.set(0, 1.55, 0.02);
    this.body.add(saddle, pad);

    // ---- Legs: [LF, RF, LH, RH]; left = +X ----
    this.legs = [];
    const legDefs = [
      { x: 0.2, z: 0.62, front: true }, { x: -0.2, z: 0.62, front: true },
      { x: 0.21, z: -0.66, front: false }, { x: -0.21, z: -0.66, front: false },
    ];
    for (const d of legDefs) {
      const hip = new THREE.Group();
      hip.position.set(d.x, 1.1, d.z);
      const upper = new THREE.Mesh(geo(d.front ? 'uF' : 'uH', () => tapered(d.front ? 0.1 : 0.14, 0.065, 0.5)), d.front ? coatMat : coatMat);
      if (!d.front) upper.scale.set(1, 1, 1.4);
      const knee = new THREE.Group();
      knee.position.y = -0.5;
      const lower = new THREE.Mesh(geo('low', () => tapered(0.052, 0.045, 0.46)), legMat);
      const wrap = new THREE.Mesh(geo('wrap', () => tapered(0.066, 0.064, 0.3)), wrapMat);
      wrap.position.y = -0.1;
      const hoof = new THREE.Mesh(geo('hoof', () => { const g = new THREE.CylinderGeometry(0.06, 0.075, 0.09, 8); g.translate(0, -0.045, 0.01); return g; }), hoofMat);
      hoof.position.y = -0.46;
      knee.add(lower, wrap, hoof);
      hip.add(upper, knee);
      this.body.add(hip);
      this.legs.push({ hip, knee, front: d.front, hoof });
    }

    // ---- Rider ----
    this.rider = new THREE.Group();
    this.rider.position.set(0, 1.62, 0.02);
    this.body.add(this.rider);
    const jersey = new THREE.MeshStandardMaterial({ map: jerseyTexture(team, umpire ? null : number, umpire), roughness: 0.8 });
    const whites = mat(0xf3f1ea, 0.85);
    const boots = mat(0x3a2414, 0.35);
    const skin = mat(0xc99a78, 0.7);
    const helmetMat = mat(umpire ? 0x111111 : team.accent, 0.35, 0.1);
    this.torsoG = new THREE.Group();
    this.torsoG.position.y = 0.12;
    const riderTorso = new THREE.Mesh(geo('rTorso', () => { const g = new THREE.CapsuleGeometry(0.17, 0.36, 4, 10); g.translate(0, 0.3, 0); return g; }), jersey);
    riderTorso.scale.set(1.15, 1, 0.78);
    const headM = new THREE.Mesh(geo('rHead', () => new THREE.SphereGeometry(0.11, 12, 10)), skin);
    headM.position.y = 0.78;
    const helmet = new THREE.Mesh(geo('helmet', () => new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), helmetMat);
    helmet.position.y = 0.8;
    const peak = new THREE.Mesh(geo('peak', () => new THREE.CylinderGeometry(0.15, 0.15, 0.015, 14, 1, false, -0.9, 1.8)), helmetMat);
    peak.position.set(0, 0.79, 0.02);
    const guard = new THREE.Mesh(geo('guard', () => new THREE.TorusGeometry(0.115, 0.008, 4, 16, Math.PI)), mat(0x999999, 0.3, 0.8));
    guard.position.set(0, 0.74, 0.02); guard.rotation.x = 0.4;
    this.torsoG.add(riderTorso, headM, helmet, peak, guard);
    this.rider.add(this.torsoG);
    this.headMesh = headM;
    // Thighs & boots
    for (const s of [1, -1]) {
      const thigh = new THREE.Mesh(geo('thigh', () => tapered(0.085, 0.07, 0.45)), whites);
      thigh.position.set(s * 0.17, 0.08, 0.02);
      thigh.rotation.set(-0.75, 0, s * 0.38);
      const shin = new THREE.Mesh(geo('boot', () => tapered(0.07, 0.06, 0.5)), boots);
      shin.position.set(0, -0.45, 0);
      shin.rotation.x = 1.45;
      const kneePad = new THREE.Mesh(geo('kpad', () => new THREE.SphereGeometry(0.08, 8, 6)), boots);
      kneePad.position.set(0, -0.45, 0.02);
      thigh.add(shin, kneePad);
      this.rider.add(thigh);
    }
    // Left arm holds the reins; right arm is driven by the mallet in world space.
    this.leftArm = new THREE.Mesh(geo('arm', () => tapered(0.05, 0.04, 0.55)), jersey);
    this.leftArm.position.set(0.21, 0.6, 0);
    this.leftArm.rotation.set(-0.9, 0, 0.18);
    this.torsoG.add(this.leftArm);
    this.rightArmMat = jersey;

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.phaseVis = 0;
  }

  /** Animate from a Rider sim instance. */
  update(r, dt) {
    const h = Math.PI / 2 - r.heading;
    this.root.position.set(r.pos.x, 0, r.pos.z);
    this.root.rotation.y = h;
    const k = Math.min(1, r.speed / 14);
    const ph = r.gaitPhase * Math.PI * 2;
    const offs = legOffsets(r.speed);
    const duty = 0.66 - 0.26 * k;
    const amp = 0.12 + 0.5 * k;
    const moving = r.speed > 0.15;
    for (let i = 0; i < 4; i++) {
      const L = this.legs[i];
      let hipA = 0, kneeA = 0;
      if (moving) {
        const p = (r.gaitPhase + offs[i]) % 1;
        if (p < duty) {
          const u = p / duty;                 // stance: planted foot sweeps back
          hipA = amp * (1 - 2 * u);
          kneeA = L.front ? 0.05 : -0.05;
        } else {
          const u = (p - duty) / (1 - duty);  // swing: fold and reach forward
          hipA = -amp + 2 * amp * (u * u * (3 - 2 * u));
          const fold = Math.sin(u * Math.PI) * (0.6 + 0.8 * k);
          kneeA = L.front ? fold : -fold * 0.8;
        }
      }
      L.hip.rotation.x += (-hipA * (L.front ? 1 : 0.9) - L.hip.rotation.x) * Math.min(1, dt * 30);
      L.knee.rotation.x += (kneeA - L.knee.rotation.x) * Math.min(1, dt * 30);
    }
    // Body bob, rocking pitch (canter/gallop) and banking lean.
    const bob = moving ? Math.abs(Math.sin(ph)) * (0.03 + 0.07 * k) : 0;
    this.body.position.y = -bob + 0.02;
    this.body.rotation.x = moving ? Math.sin(ph) * 0.05 * k : 0;
    this.body.rotation.z = r.lean;
    this.neck.rotation.x = 0.75 - (moving ? Math.sin(ph + 1.2) * 0.12 * k : Math.sin(performance.now() * 0.0007) * 0.03) + k * 0.25;
    // Rider: forward seat at speed, stands in stirrups at gallop.
    this.rider.position.y = 1.62 + k * 0.08 + (moving ? Math.sin(ph * 2) * 0.012 : 0);
    this.torsoG.rotation.x = 0.1 + k * 0.45 + (r.swing.state === 'strike' ? 0.3 : 0);
    this.torsoG.rotation.z = r.lean * 0.4 + (r.swing.state !== 'idle' ? 0.25 * r.malletSide : 0);
  }
}

/** World-space mallet (cane shaft + cigar head) and right arm, driven by rider sim. */
export class MalletModel {
  constructor(armMat) {
    this.group = new THREE.Group();
    const cane = mat(0xd9c28c, 0.55);
    const headMat = mat(0xe8dcc0, 0.5);
    this.shaft = new THREE.Mesh(geo('shaft', () => { const g = new THREE.CylinderGeometry(0.012, 0.016, 1, 6); g.translate(0, 0.5, 0); return g; }), cane);
    this.headM = new THREE.Mesh(geo('mhead', () => { const g = new THREE.CylinderGeometry(0.03, 0.03, 0.23, 10); g.rotateZ(Math.PI / 2); return g; }), headMat);
    this.grip = new THREE.Mesh(geo('grip', () => { const g = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6); g.translate(0, 0.1, 0); return g; }), mat(0x222222, 0.8));
    this.arm = new THREE.Mesh(geo('warm', () => { const g = new THREE.CylinderGeometry(0.04, 0.05, 1, 6); g.translate(0, 0.5, 0); return g; }), armMat || mat(0xffffff));
    for (const m of [this.shaft, this.headM, this.grip, this.arm]) { m.castShadow = true; this.group.add(m); }
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  orient(mesh, from, to) {
    const d = this._a.subVectors(to, from);
    const len = d.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this.up, d.divideScalar(len || 1));
    mesh.scale.set(1, len, 1);
  }

  update(r, showArm = true, bodyY = 0) {
    const shoulder = this._b.copy(r.pos).add(new THREE.Vector3(0, 2.2 + bodyY, 0)).addScaledVector(r.right, 0.22);
    const head = r.head;
    const hand = new THREE.Vector3().lerpVectors(shoulder, head, 0.27);
    if (r.vrMallet) hand.copy(r.vrMallet.hand);
    this.orient(this.shaft, hand, head);
    this.orient(this.grip, hand, this._a.copy(hand).lerp(head, 0.1));
    this.grip.scale.set(1, 1, 1);
    this.arm.visible = showArm && !r.vrMallet;
    if (this.arm.visible) this.orient(this.arm, shoulder, hand);
    // Mallet head lies across the shaft, roughly along the direction of swing.
    this.headM.position.copy(head);
    const shaftDir = new THREE.Vector3().subVectors(head, hand).normalize();
    const along = new THREE.Vector3().crossVectors(shaftDir, r.right).normalize();
    const m = new THREE.Matrix4().makeBasis(along, shaftDir, new THREE.Vector3().crossVectors(along, shaftDir));
    this.headM.quaternion.setFromRotationMatrix(m);
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { legOffsets } from '../game/rider.js';
import { loft, hairNormalMap } from './loft.js';

/*
 * Realistic procedural polo pony + rider.
 *  - Lofted anatomical body: hindquarters, barrel, withers, arched neck, wedge-shaped head with jowl.
 *  - Jointed legs: forearm/knee/cannon/fetlock/pastern/hoof (front) and gaskin/hock/cannon (hind).
 *  - Polo turn-out: hogged mane, taped tail, team leg wraps, polo saddle, breastplate, bridle, reins.
 *  - Physically based coat (sheen + hair-direction normal map) and black "points" on bays.
 * Parts are vertex-coloured and merged per animated segment to keep draw calls low on Quest.
 * Local +Z is forward; the off-side (right) is local −X.
 */

const COATS = [
  { name: 'bay', body: 0x6b3a1f, points: 0x15100c, mane: 0x120d0a, socks: 0 },
  { name: 'chestnut', body: 0x8a4520, points: 0x7a3a18, mane: 0x6a3014, socks: 2 },
  { name: 'dark bay', body: 0x3a2214, points: 0x120c08, mane: 0x0e0a08, socks: 0 },
  { name: 'grey', body: 0x9c9893, points: 0x5e5a56, mane: 0xd8d4cc, socks: 0 },
  { name: 'liver chestnut', body: 0x5a2e18, points: 0x4a2412, mane: 0x3a1a0e, socks: 1 },
  { name: 'bay', body: 0x7a4422, points: 0x18110c, mane: 0x120d0a, socks: 3 },
];

let hairTex = null;
function hair() {
  if (!hairTex) { hairTex = hairNormalMap(256, 1, 7); hairTex.repeat.set(10, 6); }
  return hairTex;
}

const C = (hex) => new THREE.Color(hex);

function jerseyTexture(team, number, striped = false) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const col = '#' + team.color.toString(16).padStart(6, '0');
  const acc = '#' + team.accent.toString(16).padStart(6, '0');
  if (striped) {
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#141414' : '#f2f2f2'; g.fillRect(i * 32, 0, 32, 512); }
  } else {
    g.fillStyle = col; g.fillRect(0, 0, 512, 512);
    // Fabric weave + soft folds
    for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 6); }
    const grd = g.createLinearGradient(0, 0, 512, 0);
    for (let k = 0; k <= 8; k++) grd.addColorStop(k / 8, k % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    // Collar & shoulder piping
    g.fillStyle = acc; g.fillRect(0, 0, 512, 26); g.fillRect(0, 300, 512, 10);
    if (number != null) {
      g.font = 'bold 150px Arial Black, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.4)'; g.fillStyle = acc;
      for (const x of [128, 384]) { g.strokeText(String(number), x, 175); g.fillText(String(number), x, 175); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Two-bone IK: returns elbow position given shoulder S, target H, bone lengths, and a pole hint. */
export function ikElbow(S, H, L1, L2, pole, out = new THREE.Vector3()) {
  const dir = new THREE.Vector3().subVectors(H, S);
  let d = dir.length();
  const maxD = (L1 + L2) * 0.999;
  dir.divideScalar(d || 1);
  d = Math.min(d, maxD);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(S).addScaledVector(dir, a).addScaledVector(pp, h);
}

const UPV = new THREE.Vector3(0, 1, 0);
function placeBetween(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UPV, d.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

/** Merge all child meshes of `group` by material category into single vertex-coloured meshes. */
function bake(group, materials) {
  const buckets = {};
  for (const m of [...group.children]) {
    if (!m.isMesh || !m.userData.cat) continue;
    m.updateMatrix();
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const col = m.userData.color;
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    (buckets[m.userData.cat] ||= []).push(g);
    group.remove(m);
  }
  for (const [cat, geos] of Object.entries(buckets)) {
    const merged = mergeGeometries(geos, false);
    const mesh = new THREE.Mesh(merged, materials[cat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function part(geo, color, cat = 'horse') {
  const m = new THREE.Mesh(geo);
  m.userData = { cat, color: color instanceof THREE.Color ? color : C(color) };
  return m;
}

export class HorseModel {
  constructor({ team, number, coatIndex = 0, umpire = false, quality = 'high' }) {
    const segs = quality === 'low' ? 12 : 18;
    this.team = team;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const coat = COATS[coatIndex % COATS.length];
    const coatC = C(coat.body).offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
    const points = C(coat.points), mane = C(coat.mane);
    const white = C(0xece6da), hoofC = C(0x2a2420), tack = C(0x3b2414), tackDark = C(0x1d130c);
    const wrapC = C(umpire ? 0xf0f0f0 : team.wrap);
    const muzzleC = coatC.clone().lerp(points, 0.35).offsetHSL(0, -0.05, -0.02);

    this.mats = {
      horse: quality === 'low' ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }) : new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.5, metalness: 0, normalMap: hair(), normalScale: new THREE.Vector2(0.05, 0.05),
        sheen: 0.7, sheenRoughness: 0.42, sheenColor: coatC.clone().lerp(C(0xffe6c8), 0.45), clearcoat: 0.08, clearcoatRoughness: 0.6,
      }),
      tack: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide }),
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }),
      eye: new THREE.MeshPhysicalMaterial({ color: 0x0a0605, roughness: 0.05, clearcoat: 1 }),
      skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }),
      helmet: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9 }),
    };
    const M = this.mats;

    // ================= BODY =================
    const bodySecs = [
      { p: [0, 1.36, -1.03], w: 0.05, ht: 0.05, hb: 0.05 },
      { p: [0, 1.33, -0.97], w: 0.19, ht: 0.12, hb: 0.2 },
      { p: [0, 1.30, -0.84], w: 0.31, ht: 0.16, hb: 0.34 },
      { p: [0, 1.28, -0.64], w: 0.37, ht: 0.17, hb: 0.38 },
      { p: [0, 1.27, -0.40], w: 0.36, ht: 0.15, hb: 0.36 },
      { p: [0, 1.25, -0.12], w: 0.385, ht: 0.16, hb: 0.41 },
      { p: [0, 1.25, 0.16], w: 0.375, ht: 0.2, hb: 0.43, n: 2.2 },
      { p: [0, 1.27, 0.40], w: 0.32, ht: 0.25, hb: 0.42, n: 2.2 },
      { p: [0, 1.23, 0.60], w: 0.27, ht: 0.27, hb: 0.35 },
      { p: [0, 1.19, 0.73], w: 0.2, ht: 0.22, hb: 0.25 },
      { p: [0, 1.19, 0.79], w: 0.08, ht: 0.08, hb: 0.08 },
    ];
    const body = loft(bodySecs, { segs: segs + 6, smoothIters: 2 });
    this.body.add(part(body, coatC));
    // Muscle masses: shoulder blades and hip/stifle bulges break up the tube silhouette.
    for (const s of [1, -1]) {
      const sh = part(new THREE.SphereGeometry(0.2, 12, 10), coatC); sh.position.set(s * 0.17, 1.24, 0.5); sh.scale.set(0.5, 1.2, 0.85); sh.rotation.x = -0.45;
      const hip = part(new THREE.SphereGeometry(0.22, 12, 10), coatC); hip.position.set(s * 0.2, 1.22, -0.62); hip.scale.set(0.55, 1.15, 1.2);
      this.body.add(sh, hip);
    }

    // ================= TACK =================
    const saddle = loft([
      { p: [0, 1.455, -0.34], w: 0.13, ht: 0.06, hb: 0.02 },
      { p: [0, 1.445, -0.24], w: 0.22, ht: 0.05, hb: 0.03 },
      { p: [0, 1.43, -0.02], w: 0.24, ht: 0.03, hb: 0.03 },
      { p: [0, 1.46, 0.18], w: 0.22, ht: 0.05, hb: 0.03 },
      { p: [0, 1.5, 0.28], w: 0.14, ht: 0.07, hb: 0.03 },
    ], { segs, smoothIters: 1 });
    this.body.add(part(saddle, tack, 'tack'));
    // Saddle cloth and leather flaps: shells that follow the barrel instead of flat boxes.
    const under = (z0, z1) => bodySecs.filter((q) => q.p[2] >= z0 && q.p[2] <= z1);
    const clothSecs = [{ ...bodySecs[5], p: [0, 1.25, -0.3] }, ...under(-0.15, 0.2), { ...bodySecs[6], p: [0, 1.25, 0.3] }];
    this.body.add(part(loft(clothSecs, { segs: 20, arc: [-0.62, Math.PI + 0.62], scale: 1.035, smoothIters: 1 }), umpire ? C(0x222222) : white, 'cloth'));
    const flapSecs = [{ ...bodySecs[5], p: [0, 1.25, -0.16] }, { ...bodySecs[6], p: [0, 1.25, 0.24] }];
    for (const [a0, a1] of [[-0.42, 0.45], [Math.PI - 0.45, Math.PI + 0.42]]) {
      this.body.add(part(loft(flapSecs, { segs: 6, arc: [a0, a1], scale: 1.06 }), tack, 'tack'));
    }
    for (const s of [1, -1]) {
      const leather = part(new THREE.BoxGeometry(0.02, 0.55, 0.022), tackDark, 'tack');
      leather.position.set(s * 0.405, 1.12, 0.12); leather.rotation.z = s * 0.05;
      const iron = part(new THREE.TorusGeometry(0.055, 0.008, 4, 10), C(0xbfc4c8), 'metal');
      iron.position.set(s * 0.41, 0.83, 0.12); iron.rotation.y = Math.PI / 2;
      this.body.add(leather, iron);
    }
    // Girth & breastplate
    const girth = part(new THREE.TorusGeometry(1, 0.03, 4, 28), tackDark, 'tack');
    girth.position.set(0, 1.235, 0.2); girth.scale.set(0.395, 0.44, 1);
    const breast = part(new THREE.TorusGeometry(1, 0.025, 4, 24, Math.PI), tack, 'tack');
    breast.position.set(0, 1.28, 0.55); breast.rotation.set(Math.PI / 2 + 0.25, 0, 0); breast.scale.set(0.285, 0.36, 1);
    this.body.add(girth, breast);

    // ================= TAIL (polo: tied up and taped) =================
    const tail = loft([
      { p: [0, 1.36, -1.0], w: 0.055, ht: 0.055, hb: 0.055 },
      { p: [0, 1.25, -1.07], w: 0.06, ht: 0.06, hb: 0.06 },
      { p: [0, 1.08, -1.09], w: 0.075, ht: 0.07, hb: 0.07 },
      { p: [0, 0.96, -1.07], w: 0.06, ht: 0.06, hb: 0.06 },
      { p: [0, 0.9, -1.05], w: 0.03, ht: 0.03, hb: 0.03 },
    ], { segs: 10, smoothIters: 1 });
    this.body.add(part(tail, mane));
    for (const y of [1.17, 1.02]) {
      const tape = part(new THREE.CylinderGeometry(0.078, 0.078, 0.06, 10), wrapC, 'cloth');
      tape.position.set(0, y, -1.08); tape.rotation.x = 0.1;
      this.body.add(tape);
    }

    // ================= NECK =================
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.42, 0.55);
    const neckPts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const p0 = new THREE.Vector3(0, 0, 0), p1 = new THREE.Vector3(0, 0.36, 0.26), p2 = new THREE.Vector3(0, 0.56, 0.5);
      const p = p0.clone().multiplyScalar((1 - t) ** 2).addScaledVector(p1, 2 * t * (1 - t)).addScaledVector(p2, t * t);
      neckPts.push({ p: [0, p.y, p.z], w: 0.24 - 0.13 * t, ht: 0.2 - 0.12 * t + Math.sin(t * Math.PI) * 0.03, hb: 0.27 - 0.17 * t });
    }
    this.neck.add(part(loft(neckPts, { segs, smoothIters: 1 }), coatC));
    // Hogged mane: a short ridge along the crest.
    const maneRidge = loft(neckPts.slice(1, 6).map((s) => ({ p: [0, s.p[1] + s.ht * 0.92 * 0.7, s.p[2] - s.ht * 0.92 * 0.7], w: 0.02, ht: 0.018, hb: 0.01 })), { segs: 6 });
    this.neck.add(part(maneRidge, mane));
    this.body.add(this.neck);

    // ================= HEAD =================
    this.head = new THREE.Group();
    this.head.position.set(0, 0.56, 0.5);
    this.head.rotation.x = 2.25;    // head axis points down-forward
    const headGeo = loft([
      { p: [0, 0, -0.02], w: 0.085, ht: 0.06, hb: 0.08 },
      { p: [0, 0.1, 0], w: 0.11, ht: 0.075, hb: 0.15 },
      { p: [0, 0.24, 0], w: 0.095, ht: 0.075, hb: 0.1 },
      { p: [0, 0.4, 0], w: 0.07, ht: 0.065, hb: 0.065 },
      { p: [0, 0.52, -0.005], w: 0.074, ht: 0.065, hb: 0.075 },
      { p: [0, 0.585, -0.01], w: 0.055, ht: 0.045, hb: 0.055 },
      { p: [0, 0.6, -0.01], w: 0.02, ht: 0.02, hb: 0.02 },
    ], { segs, smoothIters: 2 });
    // The loft path runs along +Y here; its "up" (ht) side faces −Z (the face/forehead side after rotation).
    this.head.add(part(headGeo, coatC));
    const muzzle = part(new THREE.SphereGeometry(0.066, 12, 8), muzzleC);
    muzzle.position.set(0, 0.54, 0.0); muzzle.scale.set(1.05, 1.1, 0.95);
    this.head.add(muzzle);
    for (const s of [1, -1]) {
      const ear = part(new THREE.ConeGeometry(0.038, 0.15, 7), coatC);
      ear.position.set(s * 0.06, -0.03, -0.06); ear.rotation.set(-2.5, 0, s * 0.25); ear.scale.set(1, 1, 0.55);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), M.eye);
      eye.position.set(s * 0.098, 0.13, -0.035); eye.castShadow = false;
      const nostril = part(new THREE.SphereGeometry(0.017, 6, 6), C(0x0d0907));
      nostril.position.set(s * 0.04, 0.585, -0.035);
      this.head.add(ear, eye, nostril);
      // Bridle cheekpieces
      const cheek = part(new THREE.BoxGeometry(0.012, 0.36, 0.02), tackDark, 'tack');
      cheek.position.set(s * 0.1, 0.24, 0.005); cheek.rotation.z = -s * 0.07;
      const bit = part(new THREE.TorusGeometry(0.025, 0.005, 4, 10), C(0xc8c8c8), 'metal');
      bit.position.set(s * 0.085, 0.45, 0.04); bit.rotation.y = Math.PI / 2;
      this.head.add(cheek, bit);
    }
    const nose = part(new THREE.TorusGeometry(1, 0.012, 4, 20), tackDark, 'tack');
    nose.position.set(0, 0.36, 0.0); nose.rotation.x = Math.PI / 2; nose.scale.set(0.088, 0.085, 1);
    const brow = part(new THREE.TorusGeometry(1, 0.01, 4, 20), tackDark, 'tack');
    brow.position.set(0, 0.04, 0.0); brow.rotation.x = Math.PI / 2; brow.scale.set(0.105, 0.1, 1);
    this.head.add(nose, brow);
    if (coat.socks >= 2) {   // blaze
      const blaze = part(new THREE.BoxGeometry(0.04, 0.42, 0.01), white);
      blaze.position.set(0, 0.3, -0.072); blaze.rotation.x = 0.04;
      this.head.add(blaze);
    }
    this.bitWorld = new THREE.Object3D(); this.bitWorld.position.set(0, 0.45, 0.04); this.head.add(this.bitWorld);
    this.neck.add(this.head);

    // ================= LEGS [LF, RF, LH, RH]; left = +X =================
    this.legs = [];
    const sockLeg = coat.socks === 1 ? [3] : coat.socks === 2 ? [2, 3] : coat.socks === 3 ? [0, 2] : [];
    const defs = [
      { x: 0.19, z: 0.58, front: true }, { x: -0.19, z: 0.58, front: true },
      { x: 0.21, z: -0.6, front: false }, { x: -0.21, z: -0.6, front: false },
    ];
    defs.forEach((d, li) => {
      const lower = coat.name.includes('chestnut') || coat.name === 'grey' ? coatC.clone().lerp(points, 0.5) : points;
      const sock = sockLeg.includes(li) ? white : lower;
      const hip = new THREE.Group();
      const knee = new THREE.Group();
      const fet = new THREE.Group();
      if (d.front) {
        hip.position.set(d.x, 1.02, d.z);
        hip.add(part(loft([
          { p: [0, 0.22, 0.02], w: 0.11, ht: 0.12, hb: 0.12 },
          { p: [0, 0, 0], w: 0.095, ht: 0.11, hb: 0.1 },
          { p: [0, -0.2, 0.0], w: 0.07, ht: 0.075, hb: 0.07 },
          { p: [0, -0.42, 0.0], w: 0.058, ht: 0.06, hb: 0.06 },
          { p: [0, -0.47, 0.0], w: 0.064, ht: 0.07, hb: 0.065 },
        ], { segs: 12, smoothIters: 1, capStart: true }), coatC));
        knee.position.set(0, -0.47, 0);
      } else {
        hip.position.set(d.x, 1.05, d.z);
        // Gaskin angles down and back to the hock.
        hip.add(part(loft([
          { p: [0, 0.2, 0.04], w: 0.14, ht: 0.18, hb: 0.18 },
          { p: [0, 0, 0], w: 0.12, ht: 0.15, hb: 0.14 },
          { p: [0, -0.22, -0.08], w: 0.085, ht: 0.09, hb: 0.1 },
          { p: [0, -0.4, -0.15], w: 0.06, ht: 0.06, hb: 0.08 },
          { p: [0, -0.46, -0.16], w: 0.058, ht: 0.06, hb: 0.085 },
        ], { segs: 12, smoothIters: 1 }), coatC));
        knee.position.set(0, -0.46, -0.16);
      }
      const cannonLen = d.front ? 0.34 : 0.4;
      knee.add(part(loft([
        { p: [0, 0, 0], w: 0.055, ht: 0.055, hb: 0.06 },
        { p: [0, -0.08, 0], w: 0.045, ht: 0.042, hb: 0.06 },
        { p: [0, -cannonLen + 0.04, 0], w: 0.043, ht: 0.04, hb: 0.058 },
        { p: [0, -cannonLen, 0], w: 0.055, ht: 0.055, hb: 0.065 },
      ], { segs: 10, smoothIters: 1 }), lower));
      // Polo wrap (bandage) over the cannon and fetlock.
      knee.add(part(loft([
        { p: [0, -0.05, 0], w: 0.058, ht: 0.056, hb: 0.07 },
        { p: [0, -cannonLen + 0.02, 0], w: 0.064, ht: 0.062, hb: 0.075 },
      ], { segs: 10, capStart: false, capEnd: false }), wrapC, 'cloth'));
      fet.position.set(0, -cannonLen, 0);
      fet.add(part(loft([
        { p: [0, 0, 0], w: 0.05, ht: 0.05, hb: 0.055 },
        { p: [0, -0.07, 0.03], w: 0.042, ht: 0.042, hb: 0.045 },
        { p: [0, -0.1, 0.045], w: 0.05, ht: 0.05, hb: 0.05 },
      ], { segs: 10 }), sock));
      fet.add(part(loft([
        { p: [0, -0.1, 0.045], w: 0.052, ht: 0.055, hb: 0.045, n: 2.3 },
        { p: [0, -0.17, 0.065], w: 0.064, ht: 0.075, hb: 0.05, n: 2.3 },
        { p: [0, -0.185, 0.068], w: 0.066, ht: 0.078, hb: 0.05, n: 2.3 },
      ], { segs: 10 }), hoofC));
      knee.add(fet);
      hip.add(knee);
      this.body.add(hip);
      this.legs.push({ hip, knee, fet, front: d.front });
    });

    // ================= RIDER =================
    this.rider = new THREE.Group();
    this.rider.position.set(0, 1.47, -0.02);
    this.body.add(this.rider);
    const jerseyMat = new THREE.MeshStandardMaterial({ map: jerseyTexture(team, umpire ? null : number, umpire), roughness: 0.85, normalMap: hair(), normalScale: new THREE.Vector2(0.15, 0.15) });
    this.jerseyMat = jerseyMat;
    const skinTones = [0xd9a982, 0xb98361, 0x8d5a3b, 0xe7c09f, 0x6b4129];
    const skinC = C(skinTones[(coatIndex * 3 + (number || 0)) % skinTones.length]);
    const breeches = C(0xf1eee6), boot = C(0x3a2214), helmetC = C(umpire ? 0x111111 : team.accent);

    this.torsoG = new THREE.Group();
    this.torsoG.position.y = 0.06;
    const torso = new THREE.Mesh(loft([
      { p: [0, 0.0, 0], w: 0.16, ht: 0.11, hb: 0.1 },
      { p: [0, 0.2, 0.01], w: 0.145, ht: 0.095, hb: 0.09 },
      { p: [0, 0.42, 0.0], w: 0.19, ht: 0.1, hb: 0.115 },
      { p: [0, 0.53, -0.01], w: 0.225, ht: 0.095, hb: 0.095 },
      { p: [0, 0.585, -0.01], w: 0.17, ht: 0.08, hb: 0.08 },
      { p: [0, 0.62, 0.0], w: 0.06, ht: 0.055, hb: 0.055 },
    ], { segs: 16, smoothIters: 1 }), jerseyMat);
    torso.castShadow = true;
    this.torsoG.add(torso);
    this.headG = new THREE.Group();
    this.headG.position.set(0, 0.6, 0.0);
    const neckR = part(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skinC, 'skin'); neckR.position.y = 0.03;
    const headR = part(new THREE.SphereGeometry(0.095, 14, 12), skinC, 'skin'); headR.position.set(0, 0.15, 0.015); headR.scale.set(0.9, 1.12, 1);
    const jaw = part(new THREE.SphereGeometry(0.07, 10, 8), skinC, 'skin'); jaw.position.set(0, 0.095, 0.04); jaw.scale.set(1, 0.8, 1);
    this.headG.add(jaw);
    const nose2 = part(new THREE.SphereGeometry(0.02, 6, 6), skinC, 'skin'); nose2.position.set(0, 0.14, 0.11);
    const shell = part(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), helmetC, 'helmet'); shell.position.set(0, 0.17, 0.0); shell.scale.set(0.95, 0.9, 1.08);
    const peak = part(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 18, 1, false, -1.0, 2.0), helmetC, 'helmet'); peak.position.set(0, 0.165, 0.03);
    const band = part(new THREE.CylinderGeometry(0.128, 0.128, 0.03, 18, 1, true), C(0x1a1a1a), 'helmet'); band.position.set(0, 0.17, 0); band.scale.set(0.95, 1, 1.08);
    this.headG.add(neckR, headR, nose2, shell, peak, band);
    // Face guard (wire cage)
    for (let k = 0; k < 3; k++) {
      const bar = part(new THREE.TorusGeometry(0.115, 0.005, 4, 14, Math.PI * 0.9), C(0xb0b4b8), 'metal');
      bar.position.set(0, 0.11 - k * 0.035, 0.0); bar.rotation.set(Math.PI / 2, 0, Math.PI * 0.05); bar.scale.set(0.95, 1.1, 1);
      this.headG.add(bar);
    }
    // Sunglasses-ish visor shade for read at distance
    const glasses = part(new THREE.BoxGeometry(0.14, 0.025, 0.02), C(0x111111), 'helmet'); glasses.position.set(0, 0.17, 0.095);
    this.headG.add(glasses);
    this.torsoG.add(this.headG);
    this.rider.add(this.torsoG);

    // Legs: thigh -> knee guard -> tall boot in the stirrup
    for (const s of [1, -1]) {
      const hipP = new THREE.Vector3(s * 0.11, 0.04, 0.02), kneeP = new THREE.Vector3(s * 0.385, -0.27, 0.22);
      const ankle = new THREE.Vector3(s * 0.4, -0.6, 0.1), toe = new THREE.Vector3(s * 0.42, -0.63, 0.24);
      const thigh = part(new THREE.CylinderGeometry(0.07, 0.095, 1, 10).translate(0, 0.5, 0), breeches, 'cloth');
      placeBetween(thigh, hipP, kneeP);
      const guard = part(new THREE.SphereGeometry(0.085, 10, 8), C(0x5a3a22), 'tack'); guard.position.copy(kneeP).add(new THREE.Vector3(s * 0.02, 0, 0.03)); guard.scale.set(0.8, 1.3, 0.9);
      const shin = part(new THREE.CylinderGeometry(0.06, 0.07, 1, 10).translate(0, 0.5, 0), boot, 'tack');
      placeBetween(shin, kneeP, ankle);
      const foot = part(new THREE.CylinderGeometry(0.045, 0.05, 1, 8).translate(0, 0.5, 0), boot, 'tack');
      placeBetween(foot, ankle, toe);
      this.rider.add(thigh, guard, shin, foot);
    }
    const seatPatch = part(new THREE.SphereGeometry(0.16, 10, 8), breeches, 'cloth'); seatPatch.position.set(0, 0.05, -0.02); seatPatch.scale.set(1.05, 0.5, 1.1);
    this.rider.add(seatPatch);

    // Arms are posed with IK each frame (world-ish space under root).
    this.arms = new THREE.Group();
    this.root.add(this.arms);
    const sleeve = new THREE.CylinderGeometry(0.045, 0.055, 1, 10).translate(0, 0.5, 0);
    const fore = new THREE.CylinderGeometry(0.036, 0.045, 1, 10).translate(0, 0.5, 0);
    const mk = (g, mat) => { const m = new THREE.Mesh(g, mat); m.castShadow = true; this.arms.add(m); return m; };
    const sleeveMat = umpire ? jerseyMat : new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.85 });
    this.armL = { up: mk(sleeve, sleeveMat), lo: mk(fore, sleeveMat), hand: mk(new THREE.SphereGeometry(0.042, 8, 6), M.tack) };
    this.armR = { up: mk(sleeve, sleeveMat), lo: mk(fore, sleeveMat), hand: mk(new THREE.SphereGeometry(0.042, 8, 6), M.tack) };
    this.armR.hand.material = this.armL.hand.material = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.6 });
    // Reins: bit -> left hand (both sides)
    this.reinGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.reins = new THREE.LineSegments(this.reinGeo, new THREE.LineBasicMaterial({ color: 0x24160d }));
    this.reins.frustumCulled = false;
    this.root.add(this.reins);

    // Bake static parts per animated segment.
    for (const g of [this.body, this.neck, this.head, this.rider, this.headG, this.torsoG, ...this.legs.flatMap((l) => [l.hip, l.knee, l.fet])]) bake(g, M);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.firstPerson = false;
    this.umpire = umpire;
    if (umpire) { this.armR.up.visible = this.armR.lo.visible = this.armR.hand.visible = true; }
  }

  setFirstPerson(v) {
    if (v === this.firstPerson) return;
    this.firstPerson = v;
    this.torsoG.visible = !v;
    for (const a of [this.armL, this.armR]) a.up.visible = a.lo.visible = !v;
  }

  /** World position of the rider's right shoulder. */
  shoulderWorld(out) { return this.torsoG.localToWorld(out.set(-0.21, 0.5, 0.0)); }

  update(r, dt) {
    const h = Math.PI / 2 - r.heading;
    this.root.position.set(r.pos.x, 0, r.pos.z);
    this.root.rotation.y = h;
    const k = Math.min(1, r.speed / 14);
    const ph = r.gaitPhase * Math.PI * 2;
    const offs = legOffsets(r.speed);
    const duty = 0.66 - 0.26 * k;
    const amp = 0.12 + 0.45 * k;
    const moving = r.speed > 0.15;
    const blend = Math.min(1, dt * 30);
    for (let i = 0; i < 4; i++) {
      const L = this.legs[i];
      let hipA = 0, kneeA = 0, fetA = 0;
      if (moving) {
        const p = (r.gaitPhase + offs[i]) % 1;
        if (p < duty) {
          const u = p / duty;                       // stance: planted hoof sweeps back, fetlock sinks
          hipA = amp * (1 - 2 * u);
          kneeA = L.front ? 0.02 : -0.04;
          fetA = -Math.sin(u * Math.PI) * (0.25 + 0.35 * k);
        } else {
          const u = (p - duty) / (1 - duty);       // swing: fold and reach
          hipA = -amp + 2 * amp * (u * u * (3 - 2 * u));
          const fold = Math.sin(u * Math.PI) * (0.55 + 0.9 * k);
          kneeA = L.front ? fold : -fold * 0.7;
          fetA = Math.sin(u * Math.PI) * (0.6 + 0.6 * k);
        }
      } else {
        // Idle: shift weight occasionally.
        fetA = i === 3 ? 0.25 + Math.sin(performance.now() * 0.0004) * 0.1 : 0;
        kneeA = i === 3 ? -0.15 : 0;
      }
      L.hip.rotation.x += (-hipA * (L.front ? 1 : 0.85) - L.hip.rotation.x) * blend;
      L.knee.rotation.x += (kneeA - L.knee.rotation.x) * blend;
      L.fet.rotation.x += (fetA - L.fet.rotation.x) * blend;
    }
    // Body bob, rocking pitch (canter/gallop) and banking lean.
    const bob = moving ? Math.abs(Math.sin(ph)) * (0.025 + 0.065 * k) : 0;
    this.body.position.y = -bob + 0.02;
    this.body.rotation.x = moving ? Math.sin(ph) * 0.045 * k : 0;
    this.body.rotation.z = r.lean;
    const t = performance.now() * 0.001;
    this.neck.rotation.x = (moving ? Math.sin(ph + 1.2) * 0.1 * k : Math.sin(t * 0.7) * 0.03) + k * 0.15;
    this.head.rotation.x = 2.25 + (moving ? Math.sin(ph + 2) * 0.06 * k : 0) - k * 0.15;
    this.head.rotation.y = !moving ? Math.sin(t * 0.3 + this.root.id) * 0.15 : 0;
    // Rider: two-point (half-seat) at speed, absorbs motion with knees.
    this.rider.position.y = 1.47 + k * 0.1 + (moving ? Math.sin(ph * 2) * 0.012 : 0);
    const sw = r.swing;
    let lean = 0, pitch = 0;
    if (sw.state !== 'idle' && !r.vrMallet) {
      // Lean out over the ball as the mallet comes down.
      const low = Math.max(0, -Math.cos(r.malletAngle));
      lean = (0.25 + 0.45 * low) * r.malletSide;
      pitch = 0.25 * low;
    }
    this.torsoG.rotation.x += ((0.1 + k * 0.42 + pitch) - this.torsoG.rotation.x) * Math.min(1, dt * 10);
    this.torsoG.rotation.z += ((r.lean * 0.4 + lean * 0.9) - this.torsoG.rotation.z) * Math.min(1, dt * 10);
    this.headG.rotation.x = -this.torsoG.rotation.x * 0.7;      // keep eyes up

    // ---- Left arm on the reins (IK) ----
    this.root.updateMatrixWorld(true);
    const [S, H, E, B] = this._v;
    this.torsoG.localToWorld(S.set(0.21, 0.5, 0.0));
    this.body.localToWorld(H.set(0.07, 1.62 + k * 0.06, 0.52));
    this.solveArm(this.armL, S, H, new THREE.Vector3(1, -1, -0.4).applyQuaternion(this.root.quaternion), E);
    // Reins from both bit rings to the hand
    this.bitWorld.getWorldPosition(B);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const a = this.reinGeo.attributes.position.array;
    const toLocal = (v) => this.root.worldToLocal(v.clone());
    const h1 = toLocal(H), b1 = toLocal(B.clone().addScaledVector(right, 0.08)), b2 = toLocal(B.clone().addScaledVector(right, -0.08));
    [h1, b1, h1, b2].forEach((v, i) => { a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; });
    this.reinGeo.attributes.position.needsUpdate = true;
    if (this.umpire) {
      // Umpire's right hand rests on the thigh.
      this.torsoG.localToWorld(S.set(-0.21, 0.5, 0.0));
      this.body.localToWorld(H.set(-0.2, 1.66, 0.25));
      this.solveArm(this.armR, S, H, new THREE.Vector3(-1, -1, -0.4).applyQuaternion(this.root.quaternion), E);
    }
  }

  /** Pose an arm (world-space S shoulder, H hand) using two-bone IK; meshes live under root. */
  solveArm(arm, S, H, pole, E) {
    const reach = 0.6;
    const d = S.distanceTo(H);
    const hand = d > reach ? S.clone().addScaledVector(H.clone().sub(S).normalize(), reach) : H.clone();
    ikElbow(S, hand, 0.31, 0.3, pole, E);
    const s = this.root.worldToLocal(S.clone()), e = this.root.worldToLocal(E.clone()), w = this.root.worldToLocal(hand.clone());
    placeBetween(arm.up, s, e);
    placeBetween(arm.lo, e, w);
    arm.hand.position.copy(w);
    return hand;
  }
}

/** World-space mallet: cane shaft + cigar head, driven by the rider sim; also poses the right arm. */
export class MalletModel {
  constructor(horse) {
    this.horse = horse;
    this.group = new THREE.Group();
    const cane = new THREE.MeshStandardMaterial({ color: 0xcfb57a, roughness: 0.45, normalMap: hair(), normalScale: new THREE.Vector2(0.2, 0.2) });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe6d6b4, roughness: 0.55 });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.014, 1, 8).translate(0, 0.5, 0), cane);
    // Cigar-shaped head (lathe), length 0.23 m.
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.026 + 0.008 * Math.sin(t * Math.PI), (t - 0.5) * 0.23)); }
    const hg = new THREE.LatheGeometry(prof, 12); hg.rotateZ(Math.PI / 2);
    this.headM = new THREE.Mesh(hg, headMat);
    this.grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 8).translate(0, 0.1, 0), new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.9 }));
    for (const m of [this.shaft, this.headM, this.grip]) { m.castShadow = true; this.group.add(m); }
    this._s = new THREE.Vector3(); this._e = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
  }

  orient(mesh, from, to, scaleLen = true) {
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(this.up, d.divideScalar(len || 1));
    if (scaleLen) mesh.scale.set(1, len, 1);
  }

  update(r, dt = 1 / 60) {
    const S = this.horse.shoulderWorld(this._s);
    const root = this.horse.root.quaternion;
    let hand, head;
    if (r.vrMallet) { hand = r.vrMallet.hand.clone(); head = r.head.clone(); }
    else {
      // Between swings the mallet is carried upright, elbow bent; during a swing follow the sim head.
      const swinging = r.swing.state !== 'idle';
      this.blend = THREE.MathUtils.clamp((this.blend ?? 0) + (swinging ? dt * 9 : -dt * 3), 0, 1);
      const carryHand = S.clone().add(new THREE.Vector3(-0.08, -0.1, 0.32).applyQuaternion(root));
      const carryHead = carryHand.clone().add(new THREE.Vector3(-0.12, 1.25, 0.35).applyQuaternion(root));
      const simHead = r.head.clone();
      const toS = new THREE.Vector3().subVectors(S, simHead).normalize();
      const simHand = simHead.clone().addScaledVector(toS, 1.3);
      const b = this.blend * this.blend * (3 - 2 * this.blend);
      head = carryHead.lerp(simHead, b);
      hand = carryHand.lerp(simHand, b);
      hand = this.horse.solveArm(this.horse.armR, S, hand, new THREE.Vector3(-1, -0.6, -0.5).applyQuaternion(root), this._e);
    }
    this.orient(this.shaft, hand, head);
    this.orient(this.grip, hand, new THREE.Vector3().lerpVectors(hand, head, 0.12), false);
    this.headM.position.copy(head);
    void dt;
    const shaftDir = new THREE.Vector3().subVectors(head, hand).normalize();
    const along = new THREE.Vector3().crossVectors(shaftDir, r.right).normalize();
    const m = new THREE.Matrix4().makeBasis(along, shaftDir, new THREE.Vector3().crossVectors(along, shaftDir));
    this.headM.quaternion.setFromRotationMatrix(m);
  }
}

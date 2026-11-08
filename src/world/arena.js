import * as THREE from 'three';
import { ARENA, TEAMS } from '../config.js';

const L = ARENA.length, W = ARENA.width;

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function fieldTexture() {
  const [c, g] = canvas(2048, 1048);
  const sx = c.width / L, sz = c.height / W;
  // Mowed stripes across the arena.
  const stripes = 15;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#3f7a2c' : '#4a8a34';
    g.fillRect((i * c.width) / stripes, 0, c.width / stripes + 1, c.height);
  }
  // Wear: the centre and goal mouths get chewed up.
  const R = rand(7);
  for (let i = 0; i < 2600; i++) {
    const x = (R() - 0.5) * L, z = (R() - 0.5) * W;
    const wear = Math.exp(-(x * x) / 300 - (z * z) / 120) + Math.exp(-((Math.abs(x) - L / 2) ** 2) / 40 - (z * z) / 25);
    if (R() > wear * 0.9 + 0.12) continue;
    g.fillStyle = `rgba(${90 + R() * 40},${80 + R() * 30},${40 + R() * 20},${0.12 + R() * 0.2})`;
    g.beginPath(); g.ellipse((x + L / 2) * sx, (z + W / 2) * sz, 3 + R() * 9, 2 + R() * 6, R() * 3, 0, 7); g.fill();
  }
  // Noise speckle
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (R() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n * 1.2; img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  // Markings
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.fillStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 7;
  const X = (x) => (x + L / 2) * sx, Z = (z) => (z + W / 2) * sz;
  g.setLineDash([26, 22]);
  g.beginPath(); g.moveTo(X(0), Z(-W / 2)); g.lineTo(X(0), Z(W / 2)); g.stroke();
  g.setLineDash([]);
  g.beginPath(); g.moveTo(X(-1.5), Z(0)); g.lineTo(X(1.5), Z(0)); g.stroke();
  for (const s of [-1, 1]) {
    // Penalty marks and goal crease
    for (const d of [18, 27]) {
      const x = s * (L / 2 - d);
      g.beginPath(); g.moveTo(X(x), Z(-1.2)); g.lineTo(X(x), Z(1.2)); g.stroke();
    }
    g.beginPath();
    g.ellipse(X(s * L / 2), Z(0), 10 * sx, 9 * sz, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2);
    g.stroke();
  }
  // Centre crest
  g.globalAlpha = 0.18; g.font = 'bold 64px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('RIDERS GANG POLO', X(0), Z(-W / 4)); g.fillText('RIDERS GANG POLO', X(0), Z(W / 4));
  g.globalAlpha = 1;
  return tex(c);
}

function noiseTexture(size = 256) {
  const [c, g] = canvas(size, size);
  const img = g.createImageData(size, size);
  const R = rand(3);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + R() * 145;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grassMaterial(map, detail, detailScale) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.uniforms.detailScale = { value: detailScale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed,1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;\nuniform sampler2D detailMap;\nuniform float detailScale;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dn = texture2D(detailMap, vWorldXZ * detailScale).r;
        float dn2 = texture2D(detailMap, vWorldXZ * detailScale * 0.13).r;
        diffuseColor.rgb *= mix(0.82, 1.12, dn) * mix(0.9, 1.08, dn2);`);
  };
  return m;
}

function boardPanelTexture() {
  const [c, g] = canvas(2048, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#f6f2e8'); grd.addColorStop(1, '#ddd5c2');
  g.fillStyle = grd; g.fillRect(0, 0, 2048, 128);
  const words = ['RIDERS GANG', 'CHUKKER CLUB', 'GALLOP & CO', 'PONY LINES'];
  const cols = ['#1f3b8a', '#7a1f2b', '#0f5a3a', '#8a5a14'];
  g.font = 'bold 50px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    g.fillStyle = cols[i];
    g.fillText(words[i], 256 + i * 512, 62, 470);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(i * 512, 10, 3, 100);
  }
  g.fillStyle = '#2b4d2a'; g.fillRect(0, 118, 2048, 10);
  const t = tex(c); t.wrapS = THREE.RepeatWrapping; return t;
}

function netTexture() {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function stripedPostTexture(colA, colB) {
  const [c, g] = canvas(32, 256);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? colA : colB; g.fillRect(0, i * 32, 32, 32); }
  return tex(c);
}

export class Arena {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.excitement = 0;
    this.flags = [];
    this.buildSky();
    this.buildLights(quality);
    this.buildGround();
    this.buildBoards();
    this.buildGoals();
    this.buildStands(quality);
    this.buildScenery(quality);
    this.buildScoreboard();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    this.sunDir = new THREE.Vector3(-0.55, 0.32, -0.45).normalize();
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { sunDir: { value: this.sunDir } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 zen = vec3(0.20,0.42,0.78), hor = vec3(0.98,0.80,0.60), gnd = vec3(0.38,0.42,0.36);
          vec3 c = mix(hor, zen, pow(max(h,0.0), 0.55));
          if (h < 0.0) c = mix(hor*0.9, gnd, clamp(-h*6.0,0.0,1.0));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0,0.75,0.45) * (pow(s, 8.0)*0.35 + pow(s, 900.0)*6.0);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(geo, m);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
    this.scene.fog = new THREE.Fog(0xe9cfae, 140, 620);
  }

  buildLights(quality) {
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x56703a, 0.9);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(80);
    sun.castShadow = true;
    const sz = quality === 'low' ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.group.add(sun, sun.target);
  }

  /** Keep the shadow frustum centred on the action. */
  focusShadows(p) {
    const s = this.sun;
    const snap = 2;
    const fx = Math.round(p.x / snap) * snap, fz = Math.round(p.z / snap) * snap;
    s.target.position.set(fx, 0, fz);
    s.position.set(fx, 0, fz).addScaledVector(this.sunDir, 80);
  }

  buildGround() {
    const detail = noiseTexture();
    this.fieldMat = grassMaterial(fieldTexture(), detail, 0.9);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(L, W), this.fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    this.group.add(field);
    // Surrounding grounds
    const [c, g] = canvas(64, 64); g.fillStyle = '#5d8a3e'; g.fillRect(0, 0, 64, 64);
    const outer = new THREE.Mesh(new THREE.CircleGeometry(700, 64), grassMaterial(tex(c), detail, 0.35));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.08;
    outer.receiveShadow = true;
    this.group.add(outer);
    // Gravel/sand track around the boards
    const track = new THREE.Mesh(new THREE.PlaneGeometry(L + 22, W + 14), new THREE.MeshStandardMaterial({ color: 0xb59a72, roughness: 1 }));
    track.rotation.x = -Math.PI / 2; track.position.y = -0.035; track.receiveShadow = true;
    this.group.add(track);
  }

  buildBoards() {
    const panel = boardPanelTexture();
    const mat = new THREE.MeshStandardMaterial({ map: panel, roughness: 0.7 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2b4d2a, roughness: 0.6 });
    const H = ARENA.boardHeight, T = 0.18;
    const addWall = (cx, cz, len, alongX) => {
      const g = new THREE.BoxGeometry(alongX ? len : T, H, alongX ? T : len);
      const m = mat.clone(); m.map = panel.clone(); m.map.needsUpdate = true; m.map.repeat.set(Math.max(1, Math.round(len / 30)), 1);
      const w = new THREE.Mesh(g, m);
      w.position.set(cx, H / 2, cz);
      w.castShadow = true; w.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : T + 0.1, 0.08, alongX ? T + 0.1 : len), capMat);
      cap.position.set(cx, H + 0.04, cz);
      this.group.add(w, cap);
    };
    addWall(0, -W / 2 - T / 2, L + 2 * T, true);
    addWall(0, W / 2 + T / 2, L + 2 * T, true);
    const seg = (W - ARENA.goalWidth) / 2;
    for (const s of [-1, 1]) {
      addWall(s * (L / 2 + T / 2), -(ARENA.goalWidth / 2 + seg / 2), seg, false);
      addWall(s * (L / 2 + T / 2), ARENA.goalWidth / 2 + seg / 2, seg, false);
    }
  }

  buildGoals() {
    const net = netTexture();
    this.nets = [];
    for (const s of [-1, 1]) {
      const team = TEAMS[s > 0 ? 1 : 0];
      const postTex = stripedPostTexture('#ffffff', '#' + team.color.toString(16).padStart(6, '0'));
      const postMat = new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.6 });
      const gx = s * L / 2;
      for (const z of [-ARENA.goalWidth / 2, ARENA.goalWidth / 2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, ARENA.goalHeight, 12), postMat);
        post.position.set(gx, ARENA.goalHeight / 2, z);
        post.castShadow = true;
        this.group.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, ARENA.goalWidth, 8), postMat);
      bar.rotation.x = Math.PI / 2; bar.position.set(gx, ARENA.goalHeight, 0);
      this.group.add(bar);
      // Net box
      const nm = new THREE.MeshStandardMaterial({ map: net, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1, depthWrite: true });
      const D = ARENA.goalDepth, Hh = ARENA.goalHeight, Wg = ARENA.goalWidth;
      const netGroup = new THREE.Group();
      const back = new THREE.Mesh(new THREE.PlaneGeometry(Wg, Hh, 8, 6), nm.clone());
      back.material.map = net.clone(); back.material.map.repeat.set(Wg * 2, Hh * 2); back.material.map.needsUpdate = true;
      back.rotation.y = Math.PI / 2; back.position.set(gx + s * D, Hh / 2, 0);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(D, Wg), back.material);
      top.rotation.x = Math.PI / 2; top.position.set(gx + s * D / 2, Hh, 0);
      for (const z of [-Wg / 2, Wg / 2]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(D, Hh), back.material);
        side.position.set(gx + s * D / 2, Hh / 2, z);
        netGroup.add(side);
      }
      netGroup.add(back, top);
      this.group.add(netGroup);
      this.nets.push({ side: s, mesh: back, base: back.position.x, bulge: 0 });
    }
  }

  buildStands(quality) {
    const standMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.85 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x24456e, roughness: 0.7 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.5, side: THREE.DoubleSide });
    const crowdPos = [];
    const R = rand(11);
    for (const s of [-1, 1]) {
      const z0 = s * (W / 2 + 7.5);
      const len = L * 0.82;
      for (let row = 0; row < 7; row++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 1.05), row % 2 ? standMat : seatMat);
        step.position.set(0, 0.28 + row * 0.55, z0 + s * row * 1.05);
        step.scale.y = 1 + row * 0;
        step.receiveShadow = true;
        // Fill below each step so the stand is solid.
        const fill = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55 + row * 0.55, 1.05), standMat);
        fill.position.set(0, (0.55 + row * 0.55) / 2, z0 + s * row * 1.05);
        this.group.add(fill, step);
        const seats = Math.floor(len / 0.62);
        for (let i = 0; i < seats; i++) {
          if (R() < (quality === 'low' ? 0.55 : 0.2)) continue;
          crowdPos.push(new THREE.Vector3(-len / 2 + (i + 0.5) * 0.62 + (R() - 0.5) * 0.15, 0.55 + row * 0.55, z0 + s * row * 1.05));
        }
      }
      // Cantilever roof
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.15, 10), roofMat);
      roof.position.set(0, 7.6, z0 + s * 3.2);
      roof.rotation.x = s * 0.06;
      roof.castShadow = true;
      this.group.add(roof);
      for (let i = -3; i <= 3; i++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7.6, 8), standMat);
        col.position.set(i * len / 6.5, 3.8, z0 + s * 7.6);
        this.group.add(col);
        // Flags along the roof
        this.addFlag(new THREE.Vector3(i * len / 6.5, 7.7, z0 + s * 7.9), TEAMS[(i + 3) % 2]);
      }
    }
    // Crowd: one instanced mesh, bobbing in the vertex shader; cheers on goals.
    const body = new THREE.CapsuleGeometry(0.2, 0.42, 3, 6);
    body.translate(0, 0.42, 0);
    const head = new THREE.SphereGeometry(0.13, 6, 5); head.translate(0, 0.98, 0);
    const merged = mergeGeos([body, head]);
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
    cm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.crowdUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uExcite;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898,78.233))) * 43758.5453);
          float bob = sin(uTime * (1.5 + ph * 2.0) + ph * 6.28) * 0.03;
          float jump = max(0.0, sin(uTime * (7.0 + ph * 4.0) + ph * 20.0)) * 0.35 * uExcite;
          transformed.y += bob + jump;
          transformed.x += sin(uTime*0.7+ph*9.0)*0.02;`);
    };
    const crowd = new THREE.InstancedMesh(merged, cm, crowdPos.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const shirt = [0xf2f2f2, 0x1f5fd6, 0xc8202f, 0xffd34d, 0x2e8b57, 0xf08a5d, 0x6a4c93, 0x222222, 0xe6c79c, 0x89c2d9];
    crowdPos.forEach((p, i) => {
      const sc = 0.9 + R() * 0.2;
      m4.makeScale(sc, sc, sc).setPosition(p);
      crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i, col.setHex(shirt[Math.floor(R() * shirt.length)]));
    });
    this.group.add(crowd);
    this.crowd = crowd;
  }

  addFlag(pos, team) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 }));
    pole.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
    const g = new THREE.PlaneGeometry(1.6, 1, 10, 4);
    g.translate(0.8, 0, 0);
    const m = new THREE.MeshStandardMaterial({ color: team.color, side: THREE.DoubleSide, roughness: 0.8 });
    this._flagTime = this._flagTime || { value: 0 };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this._flagTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float k = position.x / 1.6;
          transformed.z += sin(position.x * 3.0 - uTime * 6.0 + position.y) * 0.18 * k;
          transformed.y += sin(position.x * 2.0 - uTime * 4.0) * 0.05 * k;`);
    };
    const flag = new THREE.Mesh(g, m);
    flag.position.copy(pos).add(new THREE.Vector3(0, 2.4, 0));
    flag.rotation.y = Math.PI * 0.8;
    this.group.add(pole, flag);
  }

  buildScenery(quality) {
    const R = rand(23);
    // Trees: instanced canopies + trunks around the grounds.
    const n = quality === 'low' ? 70 : 160;
    const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x3f6b2d }), n);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 6), new THREE.MeshLambertMaterial({ color: 0x4a3526 }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = 95 + R() * 180;
      const x = Math.cos(a) * d * 1.3, z = Math.sin(a) * d;
      const h = 4 + R() * 6, s = 3 + R() * 4;
      m4.compose(new THREE.Vector3(x, h + s * 0.6, z), q, new THREE.Vector3(s, s * (0.9 + R() * 0.4), s));
      canopy.setMatrixAt(i, m4);
      canopy.setColorAt(i, c.setHSL(0.24 + R() * 0.08, 0.45, 0.22 + R() * 0.12));
      m4.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h, 1));
      trunk.setMatrixAt(i, m4);
    }
    canopy.castShadow = false;
    this.group.add(canopy, trunk);
    // Distant hills
    const hills = new THREE.Mesh(new THREE.CylinderGeometry(520, 560, 60, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x8aa6a0, side: THREE.BackSide, fog: true }));
    const pos = hills.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, 30 + Math.sin(i * 0.9) * 14 + Math.sin(i * 0.37) * 18);
    hills.position.y = 0;
    this.group.add(hills);
    // Marquee tents (pony lines & pavilion), a polo-ground classic.
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf5, roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 16), tentMat);
      base.position.y = 1.5;
      const top = new THREE.Mesh(new THREE.ConeGeometry(4.6, 3.2, 16), tentMat);
      top.position.y = 4.6;
      t.add(base, top);
      t.position.set((i % 2 ? 1 : -1) * (L / 2 + 22 + i * 3), 0, -30 + i * 15);
      t.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(t);
    }
  }

  buildScoreboard() {
    const [c, g] = canvas(1024, 384);
    this.sbCanvas = c; this.sbCtx = g;
    this.sbTex = tex(c);
    const m = new THREE.MeshBasicMaterial({ map: this.sbTex, toneMapped: false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14.6, 5.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x1b1b1b }));
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), frame.material);
    const sb = new THREE.Group();
    frame.position.z = -0.25; legs.position.set(-5, -6.5, -0.3);
    const legs2 = legs.clone(); legs2.position.x = 5;
    sb.add(board, frame, legs, legs2);
    sb.position.set(-L / 2 - 16, 11, 0);
    sb.rotation.y = Math.PI / 2;
    this.group.add(sb);
    const sb2 = sb.clone(); sb2.position.x = L / 2 + 16; sb2.rotation.y = -Math.PI / 2;
    this.group.add(sb2);
    this.drawScoreboard([0, 0], 1, 150);
  }

  drawScoreboard(score, chukker, clock) {
    const g = this.sbCtx, c = this.sbCanvas;
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 2; i++) {
      const t = TEAMS[i];
      const x = i ? 768 : 256;
      g.fillStyle = '#' + t.color.toString(16).padStart(6, '0');
      g.fillRect(x - 200, 30, 400, 70);
      g.fillStyle = '#fff'; g.font = 'bold 46px Arial';
      g.fillText(t.name.toUpperCase(), x, 66);
      g.fillStyle = '#ffd34d'; g.font = 'bold 190px Arial Black, Arial';
      g.fillText(String(score[i]), x, 235);
    }
    g.fillStyle = '#9fb3c8'; g.font = 'bold 40px Arial';
    g.fillText(`CHUKKER ${chukker}`, 512, 150);
    const m = Math.floor(clock / 60), s = Math.floor(clock % 60);
    g.fillStyle = '#ff5a3c'; g.font = 'bold 72px Courier New, monospace';
    g.fillText(`${m}:${String(s).padStart(2, '0')}`, 512, 240);
    this.sbTex.needsUpdate = true;
  }

  goalNet(side, strength) {
    const n = this.nets.find((x) => x.side === side);
    if (n) n.bulge = strength;
  }

  update(dt) {
    this.time += dt;
    this.excitement = Math.max(0, this.excitement - dt * 0.18);
    this.crowdUniforms.uTime.value = this.time;
    this.crowdUniforms.uExcite.value = Math.min(1, this.excitement);
    if (this._flagTime) this._flagTime.value = this.time;
    for (const n of this.nets) {
      n.bulge *= Math.exp(-dt * 3);
      n.mesh.position.x = n.base + n.side * Math.sin(this.time * 18) * n.bulge * 0.3 + n.side * n.bulge * 0.4;
    }
  }
}

function mergeGeos(geos) {
  // Minimal merge for non-indexed + indexed geometries with position/normal/uv.
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'];
  const arrays = { position: [], normal: [], uv: [] };
  const index = [];
  let offset = 0;
  for (const g of geos) {
    for (const a of attrs) arrays[a].push(...g.attributes[a].array);
    const idx = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (const i of idx) index.push(i + offset);
    offset += g.attributes.position.count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  out.setIndex(index);
  return out;
}

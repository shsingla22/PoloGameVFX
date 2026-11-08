import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA, TEAMS } from '../config.js';

const L = ARENA.length, W = ARENA.width;

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** Soft-blob value noise painted at several scales (cheap fBm on a canvas). */
function paintNoise(g, w, h, R, layers) {
  for (const [count, rMin, rMax, alpha, colors] of layers) {
    for (let i = 0; i < count; i++) {
      const x = R() * w, y = R() * h, r = rMin + R() * (rMax - rMin);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const c = colors[Math.floor(R() * colors.length)];
      grd.addColorStop(0, `rgba(${c},${alpha})`); grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}

function fieldTexture(size = 2048) {
  const [c, g] = canvas(size, Math.round(size * W / L));
  const sx = c.width / L, sz = c.height / W;
  const R = rand(7);
  g.fillStyle = '#4b7a32'; g.fillRect(0, 0, c.width, c.height);
  // Natural turf variation (large patches -> fine mottling)
  paintNoise(g, c.width, c.height, R, [
    [60, 120, 320, 0.18, ['70,110,40', '58,92,34', '84,118,48', '64,104,52']],
    [500, 20, 70, 0.14, ['60,98,36', '88,124,52', '52,84,30', '96,120,58']],
  ]);
  // Mowing stripes: subtle light/dark bands from the mower's direction (along the length).
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,240,0.06)' : 'rgba(0,20,0,0.07)';
    g.fillRect((i * c.width) / stripes, 0, c.width / stripes + 1, c.height);
  }
  // Wear: centre (throw-ins) and goal mouths get chewed to dirt; scattered divots everywhere.
  const X = (x) => (x + L / 2) * sx, Z = (z) => (z + W / 2) * sz;
  for (let i = 0; i < 5200; i++) {
    const x = (R() - 0.5) * L, z = (R() - 0.5) * W;
    const wear = Math.exp(-(x * x) / 260 - (z * z) / 90) + 1.2 * Math.exp(-((Math.abs(x) - L / 2 + 2) ** 2) / 50 - (z * z) / 22) + 0.08;
    if (R() > wear) continue;
    const dirt = R() < wear * 0.7;
    g.fillStyle = dirt ? `rgba(${105 + R() * 30},${84 + R() * 20},${52 + R() * 14},${0.25 + R() * 0.45})` : `rgba(${70 + R() * 30},${92 + R() * 20},${40},${0.2 + R() * 0.3})`;
    g.beginPath(); g.ellipse(X(x), Z(z), 2 + R() * 7, 1.5 + R() * 4, R() * 3, 0, 7); g.fill();
  }
  // Fine speckle
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (R() - 0.5) * 22;
    img.data[i] += n * 0.8; img.data[i + 1] += n; img.data[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  // Painted markings (slightly broken edges, like real line paint on turf)
  g.strokeStyle = 'rgba(245,245,235,0.82)';
  g.lineWidth = 0.12 * sx;
  const line = (x1, z1, x2, z2, dash) => {
    g.setLineDash(dash ? [0.8 * sx, 0.6 * sx] : []);
    g.beginPath(); g.moveTo(X(x1), Z(z1)); g.lineTo(X(x2), Z(z2)); g.stroke();
  };
  line(0, -W / 2, 0, W / 2, true);
  line(-1.2, 0, 1.2, 0);
  for (const s of [-1, 1]) {
    for (const d of [18, 27]) line(s * (L / 2 - d), -1.4, s * (L / 2 - d), 1.4);
    g.setLineDash([]);
    g.beginPath();
    g.ellipse(X(s * L / 2), Z(0), 10 * sx, 9 * sz, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2);
    g.stroke();
  }
  // Scuff the paint
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.15})`; g.fillRect(R() * c.width, R() * c.height, 3, 3); }
  g.globalCompositeOperation = 'source-over';
  // Repaint holes with grass under the scuffs
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#4b7a32'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
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

function grassMaterial(map, detail, detailScale, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...extra });
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
        float dn2 = texture2D(detailMap, vWorldXZ * detailScale * 0.11).r;
        float dn3 = texture2D(detailMap, vWorldXZ * detailScale * 4.0).r;
        diffuseColor.rgb *= mix(0.86, 1.1, dn) * mix(0.92, 1.06, dn2) * mix(0.9, 1.08, dn3);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.82, 1.0, dn);');
  };
  return m;
}

function woodBoardTexture() {
  const [c, g] = canvas(2048, 160);
  const R = rand(5);
  // Timber planks with grain
  for (let x = 0; x < 2048; x += 128) {
    const base = 120 + R() * 30;
    g.fillStyle = `rgb(${base + 40},${base},${base - 40})`;
    g.fillRect(x, 0, 128, 160);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(60,35,15,${0.05 + R() * 0.1})`; g.lineWidth = 1 + R() * 2;
      const y = R() * 160;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 40, y + (R() - 0.5) * 10, x + 80, y + (R() - 0.5) * 10, x + 128, y + (R() - 0.5) * 6); g.stroke();
    }
    g.fillStyle = 'rgba(30,18,8,0.5)'; g.fillRect(x, 0, 2, 160);
  }
  // Painted sponsor panels (fictional)
  const words = ['RIDERS GANG', 'CHUKKER CLUB', 'GALLOP & CO', 'PONY LINES'];
  const bgs = ['#f3efe4', '#173a2a', '#f3efe4', '#5a1a22'];
  const fgs = ['#1f3b8a', '#efe6c8', '#0f5a3a', '#f3efe4'];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const x0 = i * 512 + 40;
    g.fillStyle = bgs[i]; g.fillRect(x0, 22, 432, 112);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, 130, 432, 4);
    g.fillStyle = fgs[i]; g.font = 'bold 50px Georgia, serif';
    g.fillText(words[i], x0 + 216, 80, 400);
  }
  // Weathering
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(80,60,40,${R() * 0.12})`; g.fillRect(R() * 2048, R() * 160, 2, 2); }
  g.fillStyle = 'rgba(70,90,40,0.35)'; g.fillRect(0, 146, 2048, 14);   // grass stain at the bottom
  const t = tex(c); t.wrapS = THREE.RepeatWrapping; return t;
}

function netTexture() {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(250,250,245,0.95)'; g.lineWidth = 2.5;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function stripedPostTexture(colA, colB) {
  const [c, g] = canvas(32, 256);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? colA : colB; g.fillRect(0, i * 32, 32, 32); }
  return tex(c);
}

/** fBm cloud texture for the cloud dome. */
function cloudTexture(size = 1024) {
  const [c, g] = canvas(size, size);
  const R = rand(19);
  g.clearRect(0, 0, size, size);
  paintNoise(g, size, size, R, [
    [70, 60, 180, 0.22, ['255,255,255']],
    [380, 14, 60, 0.18, ['255,255,255', '235,238,245']],
    [900, 4, 16, 0.12, ['255,255,255']],
  ]);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Preetham sky with an exposure control (the stock shader is tuned for exposure ~0.5). */
function makeSky(exposure) {
  const sky = new Sky();
  const m = sky.material;
  m.uniforms.skyExposure = { value: exposure };
  m.fragmentShader = 'uniform float skyExposure;\n' + m.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyExposure, 1.0 );');
  return sky;
}

export class Arena {
  constructor(scene, { quality = 'high', renderer } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.excitement = 0;
    this.buildSky();
    this.buildLights(quality);
    this.buildGround(quality);
    this.buildGrass(quality === 'low' ? 'low' : 'high');
    this.buildBoards();
    this.buildGoals();
    this.buildStands(quality);
    this.buildScenery(quality);
    this.buildScoreboard();
  }

  buildSky() {
    // Physically based (Preetham) sky, late-afternoon "golden hour" sun.
    const sky = makeSky(0.5);
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    const elevation = 17, azimuth = 215;
    const phi = THREE.MathUtils.degToRad(90 - elevation), theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;
    this.group.add(sky);

    // Drifting cloud dome
    this.cloudTex = cloudTexture(this.quality === 'low' ? 512 : 1024);
    this.cloudTex.repeat.set(2, 2);
    const cm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
      uniforms: { map: { value: this.cloudTex }, sunDir: { value: this.sunDir }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; varying vec2 vUv; void main(){ vDir = normalize(position); vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; varying vec2 vUv; uniform sampler2D map; uniform vec3 sunDir; uniform float uTime;
        void main(){
          if (vDir.y < 0.02) discard;
          vec2 uv = vDir.xz / (vDir.y + 0.35) * 0.35 + vec2(uTime * 0.002, uTime * 0.0007);
          float d = texture2D(map, uv).a;
          float d2 = texture2D(map, uv * 2.7 + 0.3).a;
          float a = smoothstep(0.18, 0.75, d * 0.75 + d2 * 0.45) * smoothstep(0.02, 0.25, vDir.y);
          float sun = pow(max(dot(vDir, sunDir), 0.0), 6.0);
          vec3 col = mix(vec3(0.82, 0.83, 0.88), vec3(1.0, 0.86, 0.68), sun * 0.8 + (1.0 - vDir.y) * 0.35);
          col *= mix(0.78, 1.05, d2);
          gl_FragColor = vec4(col * 1.4, a * 0.85);
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), cm);
    this.clouds.renderOrder = -5;
    this.group.add(this.clouds);
    this.scene.fog = new THREE.Fog(0xc9c3b4, 160, 900);

    // Image-based lighting from the sky (soft ambient + reflections on coats, helmets, ball).
    if (this.renderer) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      const envSky = makeSky(0.5); envSky.scale.setScalar(1000);
      for (const k of Object.keys(u)) if (k !== 'skyExposure') envSky.material.uniforms[k].value = u[k].value;
      envScene.add(envSky);
      const groundBounce = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: 0x3a5a26 }));
      groundBounce.rotation.x = -Math.PI / 2; groundBounce.position.y = -2;
      envScene.add(groundBounce);
      this.envRT = pmrem.fromScene(envScene, 0, 1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.55;
      pmrem.dispose();
    }
  }

  buildLights(quality) {
    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a5a2a, 0.35);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a8, 3.4);
    sun.position.copy(this.sunDir).multiplyScalar(90);
    sun.castShadow = true;
    const sz = quality === 'low' ? 1024 : 4096;
    sun.shadow.mapSize.set(sz, sz);
    const sc = sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.group.add(sun, sun.target);
  }

  /** Keep the shadow frustum centred on the action (texel-snapped to avoid shimmering). */
  focusShadows(p) {
    const s = this.sun;
    const snap = 68 / s.shadow.mapSize.x * 4;
    const fx = Math.round(p.x / snap) * snap, fz = Math.round(p.z / snap) * snap;
    s.target.position.set(fx, 0, fz);
    s.position.set(fx, 0, fz).addScaledVector(this.sunDir, 90);
  }

  buildGround(quality) {
    this.detail = noiseTexture();
    this.fieldMap = fieldTexture(quality === 'low' ? 2048 : 4096);
    this.fieldMat = grassMaterial(this.fieldMap, this.detail, 1.3);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(L, W), this.fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    this.group.add(field);
    // Surrounding grounds: rougher, longer grass with mown paths.
    const [c, g] = canvas(512, 512);
    const R = rand(31);
    g.fillStyle = '#56813a'; g.fillRect(0, 0, 512, 512);
    paintNoise(g, 512, 512, R, [[120, 20, 90, 0.25, ['78,112,46', '96,126,58', '64,96,40', '120,130,70']]]);
    const outerTex = tex(c); outerTex.wrapS = outerTex.wrapT = THREE.RepeatWrapping; outerTex.repeat.set(30, 30);
    const outer = new THREE.Mesh(new THREE.CircleGeometry(900, 64), grassMaterial(outerTex, this.detail, 0.5));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.08;
    outer.receiveShadow = true;
    this.group.add(outer);
    // Sand track around the boards
    const [c2, g2] = canvas(256, 256);
    g2.fillStyle = '#b39a74'; g2.fillRect(0, 0, 256, 256);
    paintNoise(g2, 256, 256, R, [[300, 3, 14, 0.25, ['150,128,96', '196,176,140', '120,100,70']]]);
    const sandTex = tex(c2); sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping; sandTex.repeat.set(24, 14);
    const track = new THREE.Mesh(new THREE.PlaneGeometry(L + 22, W + 14), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
    track.rotation.x = -Math.PI / 2; track.position.y = -0.035; track.receiveShadow = true;
    this.group.add(track);
  }

  /**
   * Real 3D grass blades in a patch that wraps around the camera (toroidally, so blades stay put
   * in the world). Blade colour is sampled from the field texture so stripes and lines show through.
   */
  buildGrass(q) {
    const count = q === 'low' ? 50000 : 300000;
    const half = q === 'low' ? 10 : 17;
    const R = rand(77);
    const pos = new Float32Array(count * 9), shade = new Float32Array(count * 3), tip = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = (R() * 2 - 1) * half, z = (R() * 2 - 1) * half;
      const a = R() * Math.PI, w = 0.0035 + R() * 0.004, h = 0.025 + R() * 0.035;
      const ca = Math.cos(a) * w, sa = Math.sin(a) * w;
      const lean = (R() - 0.5) * 0.04;
      pos.set([x - ca, 0, z - sa, x + ca, 0, z + sa, x + lean, h, z + lean * 0.5], i * 9);
      const s = 0.9 + R() * 0.2;
      shade.set([s, s, s], i * 3);
      tip.set([0, 0, 1], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 9).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
    g.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    this.grassUniforms = { uCam: { value: new THREE.Vector2() }, uHalf: { value: half }, uTime: { value: 0 }, uField: { value: this.fieldMap }, uSize: { value: new THREE.Vector2(L, W) } };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.grassUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float shade; attribute float tip;
          uniform vec2 uCam; uniform float uHalf; uniform float uTime; uniform vec2 uSize;
          varying float vShade; varying float vTip; varying vec2 vFieldUv;`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position;
          // Toroidal wrap around the camera: each blade keeps a fixed world spot.
          vec2 base = position.xz;
          vec2 w = uCam + mod(base - uCam + uHalf, 2.0 * uHalf) - uHalf;
          transformed.xz += w - base;
          float dist = length(w - uCam);
          float fade = 1.0 - smoothstep(uHalf * 0.6, uHalf * 0.98, dist);
          vec2 inside = step(abs(w), uSize * 0.5 - 0.15);
          fade *= inside.x * inside.y;
          transformed.y *= fade;
          float gust = sin(uTime * 1.7 + w.x * 0.35 + w.y * 0.21) * 0.5 + sin(uTime * 3.1 + w.x * 1.3) * 0.25;
          transformed.xz += vec2(0.012, 0.006) * gust * tip * fade;
          vShade = shade; vTip = tip;
          vFieldUv = vec2(w.x / uSize.x + 0.5, 0.5 - w.y / uSize.y);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uField; varying float vShade; varying float vTip; varying vec2 vFieldUv;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 fc = texture2D(uField, vFieldUv).rgb;
          diffuseColor.rgb = fc * vShade * mix(0.88, 1.18, vTip);`);
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.grass = mesh;
    this.group.add(mesh);
  }

  buildBoards() {
    const panel = woodBoardTexture();
    const mat = new THREE.MeshStandardMaterial({ map: panel, roughness: 0.75 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x23402a, roughness: 0.5 });
    const H = ARENA.boardHeight, T = 0.16;
    const addWall = (cx, cz, len, alongX) => {
      const g = new THREE.BoxGeometry(alongX ? len : T, H, alongX ? T : len);
      const m = mat.clone(); m.map = panel.clone(); m.map.needsUpdate = true; m.map.repeat.set(Math.max(1, Math.round(len / 26)), 1);
      const w = new THREE.Mesh(g, m);
      w.position.set(cx, H / 2, cz);
      w.castShadow = true; w.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : T + 0.12, 0.07, alongX ? T + 0.12 : len), capMat);
      cap.position.set(cx, H + 0.035, cz);
      cap.castShadow = true;
      this.group.add(w, cap);
      // Support posts every 4 m on the outside
      const n = Math.floor(len / 4);
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, H, 0.12), capMat, n);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * (len / n);
        const off = Math.sign(alongX ? cz : cx) * (T / 2 + 0.06);
        m4.makeTranslation(alongX ? cx + t : cx + off, H / 2, alongX ? cz + off : cz + t);
        posts.setMatrixAt(i, m4);
      }
      this.group.add(posts);
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
      const postTex = stripedPostTexture('#f4f4f0', '#' + team.color.toString(16).padStart(6, '0'));
      const postMat = new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.5 });
      const gx = s * L / 2;
      for (const z of [-ARENA.goalWidth / 2, ARENA.goalWidth / 2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, ARENA.goalHeight, 16), postMat);
        post.position.set(gx, ARENA.goalHeight / 2, z);
        post.castShadow = true;
        this.group.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, ARENA.goalWidth, 10), postMat);
      bar.rotation.x = Math.PI / 2; bar.position.set(gx, ARENA.goalHeight, 0);
      bar.castShadow = true;
      this.group.add(bar);
      const nm = new THREE.MeshStandardMaterial({ map: net, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 });
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
      netGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(netGroup);
      this.nets.push({ side: s, mesh: back, base: back.position.x, bulge: 0 });
    }
  }

  buildStands(quality) {
    const concrete = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.9 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a4a72, roughness: 0.55 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.35, metalness: 0.8 });
    const crowdPos = [];
    const R = rand(11);
    for (const s of [-1, 1]) {
      const z0 = s * (W / 2 + 7.5);
      const len = L * 0.82;
      const rows = 8;
      for (let row = 0; row < rows; row++) {
        const z = z0 + s * row * 0.95, y = 0.5 + row * 0.5;
        const fill = new THREE.Mesh(new THREE.BoxGeometry(len, y, 0.95), concrete);
        fill.position.set(0, y / 2, z);
        fill.receiveShadow = true; fill.castShadow = row === rows - 1;
        // Seat bench + backrest
        const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.38), seatMat);
        seat.position.set(0, y + 0.42, z - s * 0.05);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 0.05), seatMat);
        backrest.position.set(0, y + 0.62, z + s * 0.2);
        seat.receiveShadow = backrest.receiveShadow = true;
        this.group.add(fill, seat, backrest);
        const seats = Math.floor(len / 0.58);
        for (let i = 0; i < seats; i++) {
          if (R() < (quality === 'low' ? 0.5 : 0.16)) continue;
          crowdPos.push({ p: new THREE.Vector3(-len / 2 + (i + 0.5) * 0.58 + (R() - 0.5) * 0.12, y + 0.46, z - s * 0.05), s });
        }
      }
      // Front rail
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), steel);
      rail.rotation.z = Math.PI / 2; rail.position.set(0, 1.5, z0 - s * 0.6);
      this.group.add(rail);
      // Cantilever roof on steel columns
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.12, 10.5), roofMat);
      roof.position.set(0, 8.2, z0 + s * 3.4);
      roof.rotation.x = s * 0.07;
      roof.castShadow = true; roof.receiveShadow = true;
      this.group.add(roof);
      for (let i = -4; i <= 4; i++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 8.3, 10), steel);
        col.position.set(i * len / 8.4, 4.15, z0 + s * 8.1);
        col.castShadow = true;
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10.5, 6), steel);
        strut.rotation.x = Math.PI / 2; strut.position.set(i * len / 8.4, 8.05, z0 + s * 3.4);
        this.group.add(col, strut);
        if (i % 2 === 0) this.addFlag(new THREE.Vector3(i * len / 8.4, 8.3, z0 + s * 8.1), TEAMS[(i + 4) / 2 % 2]);
      }
    }
    this.buildCrowd(crowdPos, quality);
  }

  /** Seated spectators: shirt from instance colour; skin, trousers and sun-hats varied in-shader. */
  buildCrowd(crowdPos, quality) {
    const parts = [];
    const lo = quality === 'low';   // Quest: fewer segments per spectator
    const add = (geo, partId, m) => {
      geo.applyMatrix4(m);
      const n = geo.attributes.position.count;
      geo.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(n).fill(partId), 1));
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'part'].includes(k)) geo.deleteAttribute(k);
      parts.push(geo);
    };
    const M = (x, y, z, rx = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));
    add(new THREE.CapsuleGeometry(0.15, 0.3, lo ? 1 : 3, lo ? 5 : 8), 0, M(0, 0.33, -0.02, -0.08, 1.05, 1, 0.75));            // torso
    add(new THREE.SphereGeometry(0.1, lo ? 6 : 10, lo ? 4 : 8), 1, M(0, 0.74, 0, 0, 0.9, 1.08, 1));                        // head
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.03, lo ? 6 : 12), 3, M(0, 0.84, 0, 0, 1.4, 1, 1.4));             // hat brim
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.08, lo ? 5 : 10), 3, M(0, 0.88, 0));                           // hat crown
    for (const s of [1, -1]) {
      add(new THREE.CylinderGeometry(0.065, 0.07, 0.4, lo ? 4 : 7), 2, M(s * 0.09, 0.06, 0.18, Math.PI / 2));      // thigh
      add(new THREE.CylinderGeometry(0.055, 0.06, 0.42, lo ? 4 : 7), 2, M(s * 0.09, -0.17, 0.38));                 // shin
      add(new THREE.CylinderGeometry(0.04, 0.045, 0.42, lo ? 4 : 6), 0, M(s * 0.19, 0.36, 0.06, 0.35));            // arm
    }
    const geo = mergeGeometries(parts, false);
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
    cm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.crowdUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uExcite; attribute float part; varying float vPart; varying float vH1; varying float vH2;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898,78.233))) * 43758.5453);
          vH1 = fract(ph * 7.31); vH2 = fract(ph * 13.7);
          vPart = part;
          if (part > 2.5 && vH2 > 0.45) transformed = vec3(0.0, 0.7, 0.0);         // only some wear hats
          float bob = sin(uTime * (1.2 + ph * 1.5) + ph * 6.28) * 0.012;
          float jump = max(0.0, sin(uTime * (7.0 + ph * 4.0) + ph * 20.0)) * 0.3 * uExcite * step(0.25, ph);
          transformed.y += bob + jump * step(-0.3, position.y);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPart; varying float vH1; varying float vH2;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 skin = mix(vec3(0.93,0.74,0.6), vec3(0.42,0.27,0.18), vH1);
          vec3 trousers = mix(vec3(0.12,0.14,0.2), vec3(0.78,0.72,0.6), step(0.55, vH2));
          vec3 hat = mix(vec3(0.86,0.78,0.55), vec3(0.95,0.95,0.93), step(0.6, vH1));
          if (vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = skin;
          else if (vPart > 1.5 && vPart < 2.5) diffuseColor.rgb = trousers;
          else if (vPart > 2.5) diffuseColor.rgb = hat;`);
    };
    const crowd = new THREE.InstancedMesh(geo, cm, crowdPos.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
    const shirt = [0xf2f2f2, 0x9cc3e6, 0xc8202f, 0xf0e2b6, 0x2e6b4f, 0xf08a5d, 0x6a4c93, 0x2a2a2a, 0xe6c79c, 0x1f5fd6, 0xf7c6d0, 0xffffff];
    const R = rand(41);
    crowdPos.forEach(({ p, s }, i) => {
      const sc = 0.92 + R() * 0.16;
      q.setFromEuler(new THREE.Euler(0, (s > 0 ? Math.PI : 0) + (R() - 0.5) * 0.5, 0));
      m4.compose(p, q, new THREE.Vector3(sc, sc, sc));
      crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i, col.setHex(shirt[Math.floor(R() * shirt.length)]));
    });
    crowd.castShadow = true;
    crowd.receiveShadow = true;
    this.group.add(crowd);
    this.crowd = crowd;
  }

  addFlag(pos, team) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7, roughness: 0.3 }));
    pole.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
    const g = new THREE.PlaneGeometry(1.6, 1, 12, 4);
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
    flag.castShadow = true;
    this.group.add(pole, flag);
  }

  /** A broadleaf tree: clustered, displaced canopy lobes with baked AO in vertex colours. */
  treeGeometry(seed, poplar = false) {
    const R = rand(seed);
    const parts = [];
    const lobes = poplar ? 6 : 7 + Math.floor(R() * 4);
    for (let i = 0; i < lobes; i++) {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, k);
        const n = 1 + (Math.sin(v.x * 5 + seed) * Math.sin(v.y * 6 + i) * Math.sin(v.z * 4)) * 0.18 + (R() - 0.5) * 0.12;
        v.multiplyScalar(n);
        p.setXYZ(k, v.x, v.y, v.z);
      }
      const r = poplar ? 0.9 + R() * 0.3 : 1.3 + R() * 1.1;
      const a = R() * Math.PI * 2, d = poplar ? R() * 0.5 : R() * 1.6;
      const y = poplar ? 2 + i * 1.4 : 4.2 + R() * 2.4;
      g.scale(r, r * (poplar ? 1.5 : 0.85), r);
      g.translate(Math.cos(a) * d, y, Math.sin(a) * d);
      parts.push(g);
    }
    const canopy = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
    canopy.computeVertexNormals();
    const pos = canopy.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      const ao = THREE.MathUtils.clamp((y - 2.5) / 5, 0.35, 1);
      const v = (0.85 + R() * 0.25) * ao;
      cols.set([0.24 * v, 0.38 * v, 0.16 * v], k * 3);
    }
    canopy.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    canopy.deleteAttribute('uv');
    const trunk = new THREE.CylinderGeometry(0.16, 0.32, poplar ? 3 : 4.5, 7).translate(0, poplar ? 1.5 : 2.25, 0).toNonIndexed();
    trunk.deleteAttribute('uv');
    const tc = new Float32Array(trunk.attributes.position.count * 3);
    for (let k = 0; k < tc.length; k += 3) tc.set([0.22, 0.16, 0.11], k);
    trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    return mergeGeometries([canopy, trunk], false);
  }

  buildScenery(quality) {
    const R = rand(23);
    const variants = [this.treeGeometry(3), this.treeGeometry(9), this.treeGeometry(17), this.treeGeometry(5, true)];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
    const total = quality === 'low' ? 80 : 200;
    const per = Math.ceil(total / variants.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    variants.forEach((geo, vi) => {
      const inst = new THREE.InstancedMesh(geo, mat, per);
      for (let i = 0; i < per; i++) {
        let x, z;
        do { const a = R() * Math.PI * 2, d = 85 + R() * 220; x = Math.cos(a) * d * 1.35; z = Math.sin(a) * d; } while (Math.abs(z) < 45 && Math.abs(x) < 80);
        const s = (vi === 3 ? 1.6 : 1.0) * (0.8 + R() * 0.6);
        m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.3), new THREE.Vector3(s, s, s));
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, c.setHSL(0.22 + R() * 0.08, 0.3 + R() * 0.2, 0.75 + R() * 0.35));
      }
      inst.castShadow = true;
      inst.receiveShadow = true;
      this.group.add(inst);
    });
    // Rolling hills on the horizon (vertex-coloured, fogged)
    const hg = new THREE.CylinderGeometry(560, 600, 70, 96, 3, true);
    const hp = hg.attributes.position;
    const hc = new Float32Array(hp.count * 3);
    for (let i = 0; i < hp.count; i++) {
      const ang = Math.atan2(hp.getZ(i), hp.getX(i));
      const top = hp.getY(i) > 0;
      const hgt = 18 + Math.sin(ang * 3.0) * 12 + Math.sin(ang * 7.3 + 1) * 7 + Math.sin(ang * 17.0) * 2.5;
      if (top) hp.setY(i, hgt); else hp.setY(i, -10);
      const t = top ? 1 : 0;
      hc.set([0.42 - 0.1 * t, 0.52 - 0.05 * t, 0.36 - 0.06 * t], i * 3);
    }
    hg.setAttribute('color', new THREE.BufferAttribute(hc, 3));
    hg.computeVertexNormals();
    const hills = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.BackSide, roughness: 1 }));
    this.group.add(hills);
    // Marquee tents (pony lines & pavilion)
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf5, roughness: 0.65 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x1f3b6e, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 2.6, 20, 1, true), tentMat);
      base.position.y = 1.3;
      const valance = new THREE.Mesh(new THREE.CylinderGeometry(4.05, 4.05, 0.35, 20, 1, true), trim);
      valance.position.y = 2.45;
      const top = new THREE.Mesh(new THREE.ConeGeometry(4.6, 3, 20, 1, true), tentMat);
      top.position.y = 4.1;
      t.add(base, valance, top);
      t.position.set((i % 2 ? 1 : -1) * (L / 2 + 20 + i * 3), 0, -34 + i * 13);
      t.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.side = THREE.DoubleSide; } });
      this.group.add(t);
    }
  }

  buildScoreboard() {
    const [c, g] = canvas(1024, 384);
    this.sbCanvas = c; this.sbCtx = g;
    this.sbTex = tex(c);
    const m = new THREE.MeshBasicMaterial({ map: this.sbTex, toneMapped: false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.25), m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14.6, 5.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4, metalness: 0.5 }));
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), frame.material);
    const sb = new THREE.Group();
    frame.position.z = -0.25; legs.position.set(-5, -6.5, -0.3);
    const legs2 = legs.clone(); legs2.position.x = 5;
    sb.add(board, frame, legs, legs2);
    sb.position.set(-L / 2 - 16, 11, 0);
    sb.rotation.y = Math.PI / 2;
    sb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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

  update(dt, camera) {
    this.time += dt;
    this.excitement = Math.max(0, this.excitement - dt * 0.18);
    this.crowdUniforms.uTime.value = this.time;
    this.crowdUniforms.uExcite.value = Math.min(1, this.excitement);
    if (this._flagTime) this._flagTime.value = this.time;
    this.clouds.material.uniforms.uTime.value = this.time;
    if (camera) {
      const p = camera.getWorldPosition(this._cp || (this._cp = new THREE.Vector3()));
      this.grassUniforms.uCam.value.set(p.x, p.z);
      // Grass only matters near the eye; skip it from high broadcast angles.
      this.grass.visible = p.y < 8;
    }
    this.grassUniforms.uTime.value = this.time;
    for (const n of this.nets) {
      n.bulge *= Math.exp(-dt * 3);
      n.mesh.position.x = n.base + n.side * Math.sin(this.time * 18) * n.bulge * 0.3 + n.side * n.bulge * 0.4;
    }
  }
}

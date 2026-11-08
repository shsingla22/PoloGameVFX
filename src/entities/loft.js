import * as THREE from 'three';

/**
 * Loft a smooth organic mesh through a list of cross-sections.
 * Every path is assumed to lie in the model's Y-Z plane (bilateral symmetry), so the
 * section's side axis is always +X and its "up" axis is cross(tangent, X).
 *
 * section: { p: [x,y,z], w, ht, hb, n? }
 *   w  = half width (along X), ht = extent toward the section's up side, hb = toward its down side,
 *   n  = superellipse exponent (2 = ellipse, >2 boxier).
 */
export function loft(sections, { segs = 18, capStart = true, capEnd = true, smoothIters = 0, arc = null, scale = 1 } = {}) {
  // arc = [a0, a1] builds an open shell over part of the section (angle from +X toward up).
  if (smoothIters) sections = subdivide(sections, smoothIters);
  const X = new THREE.Vector3(1, 0, 0);
  const pos = [], uv = [], idx = [];
  const P = sections.map((s) => new THREE.Vector3(...s.p));
  let along = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const prev = P[Math.max(0, i - 1)], next = P[Math.min(P.length - 1, i + 1)];
    const T = new THREE.Vector3().subVectors(next, prev).normalize();
    const V = new THREE.Vector3().crossVectors(T, X).normalize();
    const n = s.n || 2;
    if (i > 0) along += P[i].distanceTo(P[i - 1]);
    for (let j = 0; j <= segs; j++) {
      const th = arc ? arc[0] + (j / segs) * (arc[1] - arc[0]) : (j / segs) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const ey = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      const h = sn >= 0 ? s.ht : s.hb;
      const q = P[i].clone().addScaledVector(X, ex * s.w * scale).addScaledVector(V, ey * h * scale);
      pos.push(q.x, q.y, q.z);
      uv.push(j / segs, along);
    }
  }
  const ring = segs + 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const addCap = (i, flip) => {
    const center = P[i];
    const ci = pos.length / 3;
    pos.push(center.x, center.y, center.z); uv.push(0.5, along);
    for (let j = 0; j < segs; j++) {
      const a = i * ring + j, b = a + 1;
      if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  if (capStart && !arc) addCap(0, false);
  if (capEnd && !arc) addCap(sections.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Catmull-Rom style resampling of sections for smoother silhouettes. */
function subdivide(sections, iters) {
  let s = sections;
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[Math.max(0, i - 1)], b = s[i], c = s[i + 1], d = s[Math.min(s.length - 1, i + 2)];
      out.push(b);
      const mid = (key) => (-a[key] + 9 * b[key] + 9 * c[key] - d[key]) / 16;
      out.push({
        p: [0, 1, 2].map((m) => (-a.p[m] + 9 * b.p[m] + 9 * c.p[m] - d.p[m]) / 16),
        w: Math.max(0.001, mid('w')), ht: Math.max(0.001, mid('ht')), hb: Math.max(0.001, mid('hb')), n: (b.n || 2) * 0.5 + (c.n || 2) * 0.5,
      });
    }
    out.push(s[s.length - 1]);
    s = out;
  }
  return s;
}

/** A tapered limb tube between two points (for arms / straps), rebuilt cheaply via scale. */
export function unitTube(r0, r1, segs = 8) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, segs, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/** Procedural hair/skin normal map: fine streaks along V (the loft direction). */
export function hairNormalMap(size = 256, streak = 1, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const h = new Float32Array(size * size);
  // Streaky height field: random per-column noise smeared along y.
  for (let x = 0; x < size; x++) {
    let v = rnd();
    for (let y = 0; y < size; y++) {
      v = v * (0.92 + 0.07 * streak) + rnd() * (0.08 - 0.07 * streak + 0.02);
      h[y * size + x] = v;
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    const nx = (l - r) * 2.2, ny = (u - d) * 2.2;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4;
    img.data[i] = (nx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

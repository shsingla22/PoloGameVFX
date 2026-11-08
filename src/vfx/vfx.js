import * as THREE from 'three';

/**
 * CPU-simulated, GPU-rendered point particles. One draw call per system.
 * Designed for Quest: fixed pools, no allocations per frame, cheap fragment shader.
 */
class ParticleSystem {
  constructor({ max = 2000, blending = THREE.NormalBlending, soft = 1.0, depthWrite = false, noise = 0 }) {
    this.max = max;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(max).map(() => Math.random()), 1);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('color', this.aCol);
    this.geo.setAttribute('size', this.aSize);
    this.geo.setAttribute('alpha', this.aAlpha);
    this.geo.setAttribute('seed', this.aSeed);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite, blending,
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft }, uNoise: { value: noise } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float seed; attribute vec3 color;
        varying float vA; varying vec3 vC; varying float vSeed;
        uniform float uScale;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 0.0, 256.0);
          vA = alpha; vC = color; vSeed = seed;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC; varying float vSeed;
        uniform float uSoft; uniform float uNoise;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = 1.0 - smoothstep(1.0 - uSoft, 1.0, r);
          if (uNoise > 0.0) {
            float n = sin(d.x*13.0 + vSeed*40.0) * sin(d.y*11.0 - vSeed*23.0);
            a *= 1.0 - uNoise * 0.5 * (n * 0.5 + 0.5);
          }
          a *= vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  spawn(px, py, pz, vx, vy, vz, life, s0, s1, r, g, b, a0 = 1, grav = 0, drag = 0) {
    let i = this.count;
    if (i >= this.max) {
      // Recycle the oldest-ish particle.
      i = Math.floor(Math.random() * this.max);
    } else this.count++;
    const i3 = i * 3;
    this.p[i3] = px; this.p[i3 + 1] = py; this.p[i3 + 2] = pz;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt) {
    let n = this.count;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove with the last live particle.
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const dk = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= dk; this.v[i3 + 1] = this.v[i3 + 1] * dk - this.grav[i] * dt; this.v[i3 + 2] *= dk;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      if (this.p[i3 + 1] < 0.02 && this.grav[i] > 0) { this.p[i3 + 1] = 0.02; this.v[i3 + 1] *= -0.3; this.v[i3] *= 0.6; this.v[i3 + 2] *= 0.6; }
      const t = 1 - this.life[i] / this.maxLife[i];
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      C[i3] = this.col[i3]; C[i3 + 1] = this.col[i3 + 1]; C[i3 + 2] = this.col[i3 + 2];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      // Fade in quickly, fade out smoothly.
      A[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }

  copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) { this.p[t3 + k] = this.p[f3 + k]; this.v[t3 + k] = this.v[f3 + k]; this.col[t3 + k] = this.col[f3 + k]; }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from]; this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
  }
}

/** Ribbon trail following the ball; brightness scales with ball speed. */
class BallTrail {
  constructor(n = 28) {
    this.n = n;
    this.hist = Array.from({ length: n }, () => new THREE.Vector3());
    this.filled = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const t = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { t[i * 2] = t[i * 2 + 1] = i / (n - 1); }
    geo.setAttribute('position', this.pos);
    geo.setAttribute('t', new THREE.BufferAttribute(t, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uInt: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.92, 0.7) } },
      vertexShader: `attribute float t; varying float vT; void main(){ vT = t; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying float vT; uniform float uInt; uniform vec3 uColor; void main(){ float a = pow(1.0 - vT, 1.6) * uInt; gl_FragColor = vec4(uColor * a, a);} `,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.side = new THREE.Vector3(); this.dir = new THREE.Vector3(); this.toCam = new THREE.Vector3();
  }

  reset(p) { for (const h of this.hist) h.copy(p); }

  update(ballPos, speed, camPos) {
    for (let i = this.n - 1; i > 0; i--) this.hist[i].copy(this.hist[i - 1]);
    this.hist[0].copy(ballPos);
    const target = Math.max(0, Math.min(1, (speed - 6) / 20));
    this.mat.uniforms.uInt.value += (target - this.mat.uniforms.uInt.value) * 0.25;
    const a = this.pos.array;
    for (let i = 0; i < this.n; i++) {
      const p = this.hist[i];
      const q = this.hist[Math.min(this.n - 1, i + 1)];
      this.dir.subVectors(p, q);
      if (this.dir.lengthSq() < 1e-6) this.dir.set(1, 0, 0);
      this.toCam.subVectors(camPos, p);
      this.side.crossVectors(this.dir, this.toCam).normalize();
      const w = 0.07 * (1 - i / this.n);
      a[i * 6] = p.x + this.side.x * w; a[i * 6 + 1] = p.y + this.side.y * w; a[i * 6 + 2] = p.z + this.side.z * w;
      a[i * 6 + 3] = p.x - this.side.x * w; a[i * 6 + 4] = p.y - this.side.y * w; a[i * 6 + 5] = p.z - this.side.z * w;
    }
    this.pos.needsUpdate = true;
  }
}

/** Expanding ring for impacts and goals. */
class Shockwaves {
  constructor(scene, n = 6) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.85, 1, 40);
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, m);
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, t: 0, life: 0, size: 1, flat: true });
    }
    this.i = 0;
  }
  spawn(pos, size, color, flat = true, life = 0.45) {
    const it = this.items[this.i++ % this.items.length];
    it.mesh.position.copy(pos);
    it.mesh.material.color.set(color);
    it.t = 0; it.life = life; it.size = size; it.flat = flat;
    it.mesh.visible = true;
    if (flat) it.mesh.rotation.set(-Math.PI / 2, 0, 0);
  }
  update(dt, camera) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) { it.mesh.visible = false; continue; }
      const s = 0.2 + it.size * (1 - (1 - u) * (1 - u));
      it.mesh.scale.setScalar(s);
      it.mesh.material.opacity = (1 - u) * 0.9;
      if (!it.flat) it.mesh.quaternion.copy(camera.quaternion);
    }
  }
}

/** Ground decals: divots and hoof scuffs (ring buffer, one draw call). */
class Decals {
  constructor(scene, n = 300) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, 'rgba(70,50,30,0.95)'); grd.addColorStop(0.6, 'rgba(80,60,35,0.6)'); grd.addColorStop(1, 'rgba(80,60,35,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, m, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.receiveShadow = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, zero);
    this.n = n; this.i = 0;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0);
    scene.add(this.mesh);
  }
  add(x, z, sx, sz, rot) {
    this.q.setFromAxisAngle(this.up, rot);
    this.m4.compose(new THREE.Vector3(x, 0.012, z), this.q, new THREE.Vector3(sx, 1, sz));
    this.mesh.setMatrixAt(this.i++ % this.n, this.m4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Tumbling confetti quads for goal celebrations. */
class Confetti {
  constructor(scene, n = 600) {
    const geo = new THREE.PlaneGeometry(0.12, 0.07);
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, m, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.n = n;
    this.items = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }));
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.zero = new THREE.Vector3(0, 0, 0);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) { this.mesh.setColorAt(i, c.setHSL(Math.random(), 0.85, 0.6)); this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); }
    this.active = 0;
    scene.add(this.mesh);
  }
  burst(pos, count, colors) {
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = Math.floor(Math.random() * this.n);
      const it = this.items[i];
      it.p.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 2, (Math.random() - 0.5) * 10));
      it.v.set((Math.random() - 0.5) * 6, 6 + Math.random() * 8, (Math.random() - 0.5) * 6);
      it.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      it.life = 4 + Math.random() * 3;
      if (colors) this.mesh.setColorAt(i, c.setHex(colors[k % colors.length]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2));
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.active = 8;
  }
  update(dt) {
    if (this.active <= 0) return;
    this.active -= dt;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.life <= 0) { this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); continue; }
      it.life -= dt;
      it.v.y -= 3.2 * dt;                       // flutter: low terminal velocity
      it.v.multiplyScalar(1 - 1.6 * dt);
      it.v.x += Math.sin(it.life * 3 + i) * 0.6 * dt;
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.02) { it.p.y = 0.02; it.v.set(0, 0, 0); it.w.multiplyScalar(0.9); }
      it.r.x += it.w.x * dt; it.r.y += it.w.y * dt; it.r.z += it.w.z * dt;
      this.q.setFromEuler(it.r);
      this.s.setScalar(it.life < 1 ? it.life : 1);
      this.mesh.setMatrixAt(i, this.m4.compose(it.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.dust = new ParticleSystem({ max: 2500, soft: 0.9, noise: 1 });
    this.turf = new ParticleSystem({ max: 900, soft: 0.25 });
    this.sparks = new ParticleSystem({ max: 2500, blending: THREE.AdditiveBlending, soft: 0.8 });
    this.trail = new BallTrail();
    this.shock = new Shockwaves(scene);
    this.decals = new Decals(scene);
    this.confetti = new Confetti(scene);
    scene.add(this.dust.points, this.turf.points, this.sparks.points, this.trail.mesh);
    this.pending = [];   // delayed effects (fireworks)
    this.time = 0;
    this.quality = 1;
  }

  setScale(px) { for (const s of [this.dust, this.turf, this.sparks]) s.mat.uniforms.uScale.value = px; }

  /** Hoof strike: kick of dust + turf proportional to speed. */
  hoof(x, z, speed, dirX, dirZ) {
    if (speed < 2) return;
    const k = Math.min(1, speed / 14);
    const n = Math.round((1 + k * 3) * this.quality);
    for (let i = 0; i < n; i++) {
      this.dust.spawn(x + (Math.random() - 0.5) * 0.3, 0.08, z + (Math.random() - 0.5) * 0.3,
        -dirX * speed * 0.15 + (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.9 * k, -dirZ * speed * 0.15 + (Math.random() - 0.5) * 1.2,
        0.9 + Math.random() * 0.9 * k, 0.25, 0.9 + k * 1.1, 0.62, 0.53, 0.38, 0.22 + 0.25 * k, -0.15, 1.6);
    }
    if (k > 0.55 && Math.random() < 0.5) {
      for (let i = 0; i < 2; i++)
        this.turf.spawn(x, 0.05, z, -dirX * speed * 0.25 + (Math.random() - 0.5), 1.5 + Math.random() * 2, -dirZ * speed * 0.25 + (Math.random() - 0.5), 0.8, 0.06, 0.05, 0.25, 0.32, 0.15, 1, 9.8, 0.3);
      if (Math.random() < 0.25) this.decals.add(x, z, 0.25, 0.35, Math.atan2(dirX, dirZ));
    }
  }

  /** Mallet strikes ball: flash, sparks, ring, turf divot. */
  hit(pos, dir, speed, color = 0xfff1c9) {
    const k = Math.min(1, speed / 30);
    const c = new THREE.Color(color);
    for (let i = 0; i < 18 + 30 * k; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 9 * k;
      this.sparks.spawn(pos.x, pos.y + 0.05, pos.z,
        dir.x * s * 0.8 + Math.cos(a) * s * 0.4, Math.random() * 3 + 1, dir.z * s * 0.8 + Math.sin(a) * s * 0.4,
        0.25 + Math.random() * 0.3, 0.09, 0.02, c.r, c.g, c.b, 1, 6, 3);
    }
    this.sparks.spawn(pos.x, pos.y + 0.1, pos.z, 0, 0, 0, 0.12, 0.3, 1.6 + k * 1.4, 1, 0.95, 0.8, 1, 0, 0);
    this.shock.spawn(new THREE.Vector3(pos.x, 0.05, pos.z), 1.6 + 2.5 * k, 0xfff2d0, true, 0.4);
    // Turf divot
    for (let i = 0; i < 10; i++) {
      this.turf.spawn(pos.x, 0.06, pos.z, dir.x * (2 + Math.random() * 4) + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, dir.z * (2 + Math.random() * 4) + (Math.random() - 0.5) * 2,
        1.0 + Math.random() * 0.4, 0.07, 0.06, 0.2 + Math.random() * 0.1, 0.33, 0.12, 1, 9.8, 0.4);
    }
    for (let i = 0; i < 8; i++)
      this.dust.spawn(pos.x, 0.1, pos.z, dir.x * 2 + (Math.random() - 0.5) * 2, Math.random() * 1.5, dir.z * 2 + (Math.random() - 0.5) * 2, 1.2, 0.3, 1.4, 0.62, 0.55, 0.4, 0.35, -0.1, 1.5);
    this.decals.add(pos.x, pos.z, 0.45, 0.7, Math.atan2(dir.x, dir.z));
  }

  bounce(pos, speed) {
    for (let i = 0; i < 4; i++)
      this.dust.spawn(pos.x, 0.05, pos.z, (Math.random() - 0.5) * 1.5, Math.random() * 0.8, (Math.random() - 0.5) * 1.5, 0.7, 0.15, 0.6, 0.6, 0.52, 0.38, Math.min(0.35, speed * 0.05), 0, 2);
  }

  board(pos, speed) {
    for (let i = 0; i < 10; i++)
      this.dust.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.6, 0.1, 0.5, 0.85, 0.8, 0.7, Math.min(0.5, speed * 0.04), 0, 2);
    this.sparks.spawn(pos.x, pos.y, pos.z, 0, 0, 0, 0.1, 0.2, 1.0, 1, 1, 1, 0.6, 0, 0);
  }

  rideoff(pos) {
    for (let i = 0; i < 14; i++)
      this.dust.spawn(pos.x + (Math.random() - 0.5), 0.2, pos.z + (Math.random() - 0.5), (Math.random() - 0.5) * 3, 0.5 + Math.random(), (Math.random() - 0.5) * 3, 1.3, 0.4, 1.8, 0.6, 0.52, 0.38, 0.4, -0.1, 1.2);
  }

  goal(pos, side, teamColor, accent) {
    const c = new THREE.Color(teamColor), a = new THREE.Color(accent);
    this.shock.spawn(new THREE.Vector3(pos.x, 1.5, pos.z), 9, teamColor, false, 0.9);
    this.shock.spawn(new THREE.Vector3(pos.x, 0.1, pos.z), 14, accent, true, 1.0);
    for (let i = 0; i < 160; i++) {
      const u = new THREE.Vector3().randomDirection();
      const s = 4 + Math.random() * 10;
      const col = Math.random() < 0.6 ? c : a;
      this.sparks.spawn(pos.x, 1.2, pos.z, u.x * s - side * 3, Math.abs(u.y) * s + 3, u.z * s, 0.8 + Math.random() * 0.6, 0.18, 0.05, col.r, col.g, col.b, 1, 7, 1.5);
    }
    this.confetti.burst(new THREE.Vector3(pos.x - side * 6, 9, 0), 450, [teamColor, accent, 0xffffff]);
    // Fireworks over the goal end, staggered.
    for (let k = 0; k < 7; k++) this.pending.push({ at: this.time + 0.3 + k * 0.38, fn: () => this.firework(new THREE.Vector3(pos.x + side * 8 + (Math.random() - 0.5) * 6, 22 + Math.random() * 10, (Math.random() - 0.5) * 26), k % 2 ? c : a) });
  }

  firework(p, col) {
    const n = Math.round(140 * this.quality);
    for (let i = 0; i < n; i++) {
      const u = new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 2);
      this.sparks.spawn(p.x, p.y, p.z, u.x, u.y, u.z, 1.4 + Math.random() * 0.6, 0.45, 0.08, col.r, col.g, col.b, 1, 3.5, 1.4);
    }
    this.sparks.spawn(p.x, p.y, p.z, 0, 0, 0, 0.25, 2, 9, 1, 0.95, 0.85, 1, 0, 0);
    this.onFirework && this.onFirework(p);
  }

  update(dt, camera, ball) {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].at <= this.time) { this.pending[i].fn(); this.pending.splice(i, 1); }
    this.dust.update(dt); this.turf.update(dt); this.sparks.update(dt);
    this.shock.update(dt, camera);
    this.confetti.update(dt);
    if (ball) this.trail.update(ball.pos, ball.speed, camera.getWorldPosition(new THREE.Vector3()));
  }
}

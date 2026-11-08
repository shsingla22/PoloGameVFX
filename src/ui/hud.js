import { ARENA, TEAMS, GAITS } from '../config.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.score = document.getElementById('score');
    this.toastEl = document.getElementById('toast');
    this.subEl = document.getElementById('subtoast');
    this.gaitEl = document.getElementById('gait');
    this.stamEl = document.getElementById('stamina-fill');
    this.chargeEl = document.getElementById('charge-fill');
    this.sideEl = document.getElementById('side');
    this.camEl = document.getElementById('cammode');
    this.feed = document.getElementById('feed');
    this.map = document.getElementById('minimap');
    this.mctx = this.map.getContext('2d');
    this.toastT = 0;
    this.flashEl = document.getElementById('flash');
    this.hintEl = document.getElementById('hint');
    this.ptrEl = document.getElementById('ballptr');
    this.flashT = 0; this.hintT = 0;
    this.score.innerHTML = `
      <div class="team" style="--c:${hex(TEAMS[0].color)}"><span class="name">${TEAMS[0].name}</span><span class="pts" id="s0">0</span></div>
      <div class="mid"><div id="chukker">CHUKKER 1</div><div id="clock">2:30</div></div>
      <div class="team right" style="--c:${hex(TEAMS[1].color)}"><span class="pts" id="s1">0</span><span class="name">${TEAMS[1].name}</span></div>`;
    this.s0 = document.getElementById('s0'); this.s1 = document.getElementById('s1');
    this.chukEl = document.getElementById('chukker'); this.clockEl = document.getElementById('clock');
  }

  show(v) { this.el.style.display = v ? 'block' : 'none'; }

  toast(text, sub = '', dur = 2.2, cls = '') {
    this.toastEl.textContent = text;
    this.subEl.textContent = sub;
    this.toastEl.className = 'show ' + cls;
    this.subEl.className = sub ? 'show' : '';
    this.toastT = dur;
  }

  /** Short centre-screen feedback ("Big hit!", "Ride-off!"). */
  flash(text) {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove('show'); void this.flashEl.offsetWidth; this.flashEl.classList.add('show');
    this.flashT = 1.0;
  }

  hint(text) { this.hintEl.textContent = text; this.hintEl.classList.add('show'); this.hintT = 5; }

  log(text, color = '#fff') {
    const d = document.createElement('div');
    d.textContent = text; d.style.color = color;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 4000);
  }

  update(dt, game) {
    const m = game.match, p = game.player;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) this.flashEl.classList.remove('show');
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.hintEl.classList.remove('show');
    const ang = game.ballPointer ? game.ballPointer() : null;
    if (ang === null || !m.inPlay) this.ptrEl.style.opacity = 0;
    else {
      const r = Math.min(innerWidth, innerHeight) * 0.38;
      this.ptrEl.style.opacity = 0.9;
      this.ptrEl.style.transform = `translate(${innerWidth / 2 + Math.cos(ang) * r * 1.3 - 18}px, ${innerHeight / 2 + Math.sin(ang) * r - 18}px) rotate(${ang}rad)`;
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) { this.toastEl.className = ''; this.subEl.className = ''; } }
    this.s0.textContent = m.score[0]; this.s1.textContent = m.score[1];
    this.chukEl.textContent = m.overtime ? 'EXTRA CHUKKER' : `CHUKKER ${m.chukker}/${m.opts.chukkers}`;
    this.clockEl.textContent = fmt(Math.max(0, m.clock));
    this.clockEl.classList.toggle('low', m.clock < 15 && m.state === 'play');
    if (p) {
      // Show the gait the pony is actually in, and where you're asking it to go.
      const actual = p.speed > GAITS[4].speed * 1.03 ? 'Flat out' : GAITS[p.gaitIndex()].name;
      const target = game.input.sprint && p.stamina > 0.05 ? 'Flat out' : GAITS[game.input.gait].name;
      this.gaitEl.innerHTML = `${actual} <small>${target !== actual ? '→ ' + target : ''}</small> · ${(p.speed * 3.6).toFixed(0)} km/h`;
      this.stamEl.style.width = `${p.stamina * 100}%`;
      this.stamEl.style.background = p.stamina < 0.25 ? '#ff5a3c' : '#5fd38d';
      const ch = p.swing.state === 'windup' ? Math.min(1, (0.45 + p.swing.charge) / 1) : 0;
      this.chargeEl.style.width = `${ch * 100}%`;
      this.sideEl.textContent = (game.input.nearSide ? 'NEAR-SIDE' : 'OFF-SIDE') + (game.swingAssist ? ' · assist' : '');
    }
    this.camEl.textContent = game.cameraMode;
    this.drawMap(game);
  }

  drawMap(game) {
    const g = this.mctx, w = this.map.width, h = this.map.height;
    const sx = w / (ARENA.length + 6), sz = h / (ARENA.width + 6);
    const X = (x) => w / 2 + x * sx, Z = (z) => h / 2 + z * sz;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(40,90,40,0.85)'; g.fillRect(X(-ARENA.length / 2), Z(-ARENA.width / 2), ARENA.length * sx, ARENA.width * sz);
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1;
    g.strokeRect(X(-ARENA.length / 2), Z(-ARENA.width / 2), ARENA.length * sx, ARENA.width * sz);
    g.beginPath(); g.moveTo(X(0), Z(-ARENA.width / 2)); g.lineTo(X(0), Z(ARENA.width / 2)); g.stroke();
    // Goals coloured by who defends them.
    for (const t of [0, 1]) {
      const gx = game.match.ownGoalX(t);
      g.fillStyle = hex(TEAMS[t].color);
      g.fillRect(X(gx) - 3, Z(-ARENA.goalWidth / 2), 6, ARENA.goalWidth * sz);
    }
    const lob = game.match.lob;
    if (lob) {
      g.strokeStyle = 'rgba(255,230,120,0.7)'; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(X(lob.origin.x), Z(lob.origin.z)); g.lineTo(X(lob.origin.x + lob.dir.x * 25), Z(lob.origin.z + lob.dir.z * 25)); g.stroke();
      g.setLineDash([]);
    }
    for (const r of game.riders) {
      g.fillStyle = hex(TEAMS[r.team].color);
      g.beginPath(); g.arc(X(r.pos.x), Z(r.pos.z), r.isPlayer ? 5 : 3.6, 0, 7); g.fill();
      if (r.isPlayer) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.beginPath(); g.moveTo(X(r.pos.x), Z(r.pos.z)); g.lineTo(X(r.pos.x + Math.cos(r.heading) * 4), Z(r.pos.z + Math.sin(r.heading) * 4)); g.stroke();
    }
    const b = game.ball.pos;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(b.x), Z(b.z), 2.6, 0, 7); g.fill();
  }
}

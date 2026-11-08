import { GAITS } from '../config.js';

/**
 * Desktop input: keyboard + mouse (pointer lock aiming) + standard gamepad.
 * Produces a normalised control state consumed by the game each frame.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.gait = 0;
    this.steer = 0;
    this.sprint = false;
    this.nearSide = false;
    this.aimOffset = 0;
    this.swingHeld = null;       // 'fore' | 'back' | null
    this.events = [];            // 'swingStart:fore', 'swingRelease', 'camera', 'pause', 'mute', 'help'
    this.padPrev = {};
    this.enabled = true;
    this.holdT = 0;              // hold W/S to keep stepping gaits

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      if (!this.enabled) { if (k === 'Escape' || k === 'KeyP') this.events.push('pause'); return; }
      if (k === 'KeyW' || k === 'ArrowUp') { this.gait = Math.min(GAITS.length - 1, this.gait + 1); this.holdT = 0; }
      if (k === 'KeyS' || k === 'ArrowDown') { this.gait = Math.max(0, this.gait - 1); this.holdT = 0; }
      if (k === 'KeyE') this.events.push('pass');
      if (k === 'Space' || k === 'KeyJ') this.startSwing('fore');
      if (k === 'KeyF' || k === 'KeyK') this.startSwing('back');
      if (k === 'KeyQ') this.nearSide = !this.nearSide;
      if (k === 'KeyC') this.events.push('camera');
      if (k === 'Escape' || k === 'KeyP') this.events.push('pause');
      if (k === 'KeyM') this.events.push('mute');
      if (k === 'KeyH') this.events.push('help');
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if ((e.code === 'Space' || e.code === 'KeyJ') && this.swingHeld === 'fore') this.endSwing();
      if ((e.code === 'KeyF' || e.code === 'KeyK') && this.swingHeld === 'back') this.endSwing();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch { /* ignore */ } }
      if (e.button === 0) this.startSwing('fore');
      if (e.button === 2) this.startSwing('back');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.swingHeld === 'fore') this.endSwing();
      if (e.button === 2 && this.swingHeld === 'back') this.endSwing();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) this.aimOffset = Math.max(-0.7, Math.min(0.7, this.aimOffset + e.movementX * 0.003));
    });
    addEventListener('blur', () => { this.keys.clear(); if (this.swingHeld) this.endSwing(); });
  }

  startSwing(kind) {
    if (this.swingHeld) return;
    this.swingHeld = kind;
    this.events.push('swingStart:' + kind);
  }

  endSwing() {
    this.swingHeld = null;
    this.events.push('swingRelease');
  }

  poll(dt) {
    const k = this.keys;
    let steer = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) steer += 1;
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    // Holding W/S keeps stepping through the gaits (tap still works one step at a time).
    const up = k.has('KeyW') || k.has('ArrowUp'), down = k.has('KeyS') || k.has('ArrowDown');
    if (up || down) {
      this.holdT += dt;
      if (this.holdT > 0.32) { this.holdT -= 0.22; this.gait = Math.max(0, Math.min(GAITS.length - 1, this.gait + (up ? 1 : -1))); }
    } else this.holdT = 0;
    if (this.sprint && this.gait < 3) this.gait = 4;      // Shift from a standstill = go
    // Aim recentres slowly when not being pushed.
    this.aimOffset *= Math.exp(-dt * 0.8);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || p.mapping !== 'standard') continue;
      const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0;
      if (ax) steer = ax;
      const ay = p.axes[1];
      const prev = this.padPrev;
      if (ay < -0.6 && !prev.up) this.gait = Math.min(GAITS.length - 1, this.gait + 1);
      if (ay > 0.6 && !prev.down) this.gait = Math.max(0, this.gait - 1);
      prev.up = ay < -0.6; prev.down = ay > 0.6;
      if (Math.abs(p.axes[2]) > 0.2) this.aimOffset = p.axes[2] * 0.6;
      if (p.buttons[0]?.pressed) this.sprint = true;
      const rt = p.buttons[7]?.pressed, lt = p.buttons[6]?.pressed;
      if (rt && !prev.rt) this.startSwing('fore');
      if (!rt && prev.rt && this.swingHeld === 'fore') this.endSwing();
      if (lt && !prev.lt) this.startSwing('back');
      if (!lt && prev.lt && this.swingHeld === 'back') this.endSwing();
      if (p.buttons[4]?.pressed && !prev.lb) this.nearSide = !this.nearSide;
      if (p.buttons[3]?.pressed && !prev.y) this.events.push('camera');
      if (p.buttons[1]?.pressed && !prev.b) this.events.push('pass');
      prev.b = p.buttons[1]?.pressed;
      if (p.buttons[9]?.pressed && !prev.start) this.events.push('pause');
      prev.rt = rt; prev.lt = lt; prev.lb = p.buttons[4]?.pressed; prev.y = p.buttons[3]?.pressed; prev.start = p.buttons[9]?.pressed;
      break;
    }
    this.steer = steer;
  }

  drain() { const e = this.events; this.events = []; return e; }
}

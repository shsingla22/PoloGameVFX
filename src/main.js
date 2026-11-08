import * as THREE from 'three';
import { Arena } from './world/arena.js';
import { VFX } from './vfx/vfx.js';
import { AudioEngine } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { Input } from './game/input.js';
import { Game } from './game/game.js';
import { Brain } from './game/ai.js';
import { XRRig } from './xr/xr.js';
import { TEAMS, DIFFICULTY } from './config.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ---------- Renderer ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 1500);
const quality = params.get('quality') || 'high';
const arena = new Arena(scene, { quality });
const vfx = new VFX(scene);
const audio = new AudioEngine();
const hud = new HUD();
const input = new Input(canvas);
const xr = new XRRig(renderer, scene, camera);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  vfx.setScale(innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
}
addEventListener('resize', resize);
resize();

// ---------- Game lifecycle ----------
let game = null;
let mode = 'menu';     // menu | play | paused | over
const settings = { difficulty: 'club', chukkers: 4, chukkerSeconds: 150 };

function newGame(demo) {
  if (game) game.dispose();
  game = new Game({ scene, camera, arena, vfx, audio, hud, input, xr, opts: { ...settings, demo } });
  if (demo) {
    // Attract mode: the "player" is also driven by AI and the camera is the broadcast view.
    game.brains.push(new Brain(game.player, DIFFICULTY.club));
    game.applyPlayerInput = () => { input.drain(); };
    game.cameraMode = 'TV';
  }
  game.onPause = togglePause;
  game.onMute = () => { audio.master && (audio.master.gain.value = audio.master.gain.value > 0 ? 0 : 0.8); hud.log(audio.master?.gain.value ? 'Sound on' : 'Muted'); };
  game.onHelp = () => $('help').classList.toggle('open');
  game.onFulltime = (d, stats) => setTimeout(() => showFulltime(d, stats), 2500);
  game.start();
  arena.drawScoreboard([0, 0], 1, settings.chukkerSeconds);
}

function startMatch() {
  audio.start();
  mode = 'play';
  input.enabled = true;
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  $('pause').classList.add('hidden');
  hud.show(!xr.active);
  newGame(false);
  xr.setVisible(xr.active);
}

function togglePause() {
  if (mode === 'play') {
    mode = 'paused'; game.paused = true; input.enabled = false;
    $('pause').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (mode === 'paused') {
    mode = 'play'; game.paused = false; input.enabled = true;
    $('pause').classList.add('hidden');
  }
}

function showFulltime(d, stats) {
  if (mode !== 'play') return;
  mode = 'over';
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const win = d.winner === 0 ? 'VICTORY' : d.winner === 1 ? 'DEFEAT' : 'DRAW';
  $('over-title').textContent = win;
  $('over-score').innerHTML = `<span style="color:#${TEAMS[0].color.toString(16).padStart(6, '0')}">${TEAMS[0].name} ${d.score[0]}</span> – <span style="color:#${TEAMS[1].color.toString(16).padStart(6, '0')}">${d.score[1]} ${TEAMS[1].name}</span>`;
  $('over-stats').innerHTML = `Shots: ${stats.hits[0]} – ${stats.hits[1]} · Fouls: ${stats.fouls[0]} – ${stats.fouls[1]}`;
  $('over').classList.remove('hidden');
  if (xr.active) game.vrMessage = `${win} ${d.score[0]}–${d.score[1]} · trigger to replay`;
}

function backToMenu() {
  mode = 'menu';
  $('over').classList.add('hidden'); $('pause').classList.add('hidden'); $('menu').classList.remove('hidden');
  hud.show(false);
  newGame(true);
}

// ---------- Menu wiring ----------
for (const el of document.querySelectorAll('[data-diff]')) el.addEventListener('click', () => {
  settings.difficulty = el.dataset.diff;
  document.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('on', b === el));
});
for (const el of document.querySelectorAll('[data-len]')) el.addEventListener('click', () => {
  settings.chukkerSeconds = Number(el.dataset.len);
  document.querySelectorAll('[data-len]').forEach((b) => b.classList.toggle('on', b === el));
});
for (const el of document.querySelectorAll('[data-chuk]')) el.addEventListener('click', () => {
  settings.chukkers = Number(el.dataset.chuk);
  document.querySelectorAll('[data-chuk]').forEach((b) => b.classList.toggle('on', b === el));
});
$('play').addEventListener('click', startMatch);
$('again').addEventListener('click', startMatch);
$('tomenu').addEventListener('click', backToMenu);
$('resume').addEventListener('click', togglePause);
$('quit').addEventListener('click', backToMenu);
$('help-btn').addEventListener('click', () => $('help').classList.toggle('open'));
$('help-close').addEventListener('click', () => $('help').classList.remove('open'));

// WebXR (Meta Quest Browser)
async function setupVR() {
  const btn = $('vr');
  if (!navigator.xr) { btn.textContent = 'VR needs a WebXR browser (Quest Browser)'; btn.disabled = true; return; }
  let ok = false;
  try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { ok = false; }
  if (!ok) { btn.textContent = window.isSecureContext ? 'VR not available on this device' : 'VR needs HTTPS'; btn.disabled = true; return; }
  btn.textContent = 'Enter VR (Meta Quest)';
  btn.addEventListener('click', async () => {
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      renderer.xr.setFoveation?.(1);
      await renderer.xr.setSession(session);
      vfx.quality = 0.6;
      vfx.setScale(780);
      startMatch();
    } catch (e) { console.error(e); hud.log('Could not start VR: ' + e.message, '#f88'); }
  });
}
xr.onStart = () => { hud.show(false); xr.setVisible(true); };
xr.onEnd = () => { vfx.quality = 1; resize(); hud.show(mode === 'play'); xr.setVisible(false); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); };
setupVR();

// In VR, pull the right trigger on the end screen to play again.
let lastTrig = false;
function vrMenuInput() {
  if (!xr.active || mode !== 'over') return;
  const r = xr.controllers.find((c) => c.hand === 'right');
  const t = !!(r?.gamepad || r?.source?.gamepad)?.buttons?.[0]?.pressed;
  if (t && !lastTrig) startMatch();
  lastTrig = t;
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
let fpsT = 0, frames = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (game) game.update(dt);
  vrMenuInput();
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 1) { $('fps').textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
});

newGame(true);
if (params.get('autostart')) startMatch();
window.__polo = { get game() { return game; }, renderer, scene, camera, startMatch, settings, xr, vfx };

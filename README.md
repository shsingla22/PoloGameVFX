# Riders Gang Polo 🐎

Arena polo (3 v 3) for **Meta Quest** (WebXR, runs in the Quest Browser) and **desktop** (keyboard/mouse/gamepad).
Built with Three.js + Vite. All horses, riders, the arena, the VFX and the audio are generated procedurally in code, so the game needs no asset downloads.

## Play

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL on a desktop browser and click **Play on desktop**.

### On a Meta Quest headset

WebXR only works on a secure (HTTPS) origin. Pick one of these:

1. **GitHub Pages (easiest).** In the repo, open Settings → Pages and set Source to "GitHub Actions". Each push to `main` then runs the tests and publishes the game. Open the Pages URL in the Quest Browser and press **Enter VR**.
2. **Local network.** Run the command below, then open `https://<your-PC-ip>:5173` in the Quest Browser. Accept the self-signed certificate warning, then press **Enter VR**.

```bash
npm run dev:quest
```

## Controls

| | Desktop | Meta Quest |
|---|---|---|
| Gait (halt → gallop) | `W` / `S` (tap or hold) | Left stick up / down |
| Steer | `A` / `D` | Left stick left / right |
| Flat-out sprint (stamina) | `Shift` | Left grip or right trigger |
| Forehand | Hold `Space` / LMB, release to strike (swing assist times the contact) | **Swing the right controller**: it is the mallet |
| Backhand | `F` / RMB | Swing backwards |
| Off-side ↔ near-side | Automatic when the ball is close; `Q` to prefer near-side | Reach to either side |
| Call for a pass | `E` (gamepad B) | |
| Fine aim | Mouse (click to lock) | Aim assist toggle: `A` |
| Camera (Chase / Rider / TV) | `C` | Seat-height recentre: `B` / `Y` |
| Pause / mute / help | `Esc` / `M` / `H` | |

## Reading the turf

- **The ring under the ball** turns **yellow** when the ball is coming into your strike lane and **green** when it's time to swing.
- **The dashed line on the turf** is the line of the ball. It is **red** when the opponents have right of way, so don't cut across it in front of them, and **gold** when it's yours.
- **An arrow at the screen edge** points to the ball when it's off screen.

## Quality tiers

`?quality=high` is the default on desktop. It adds post-processing (GTAO, bloom and a grade), 4k shadows and 300k grass blades. `?quality=low` is picked automatically in the Meta Quest Browser.

## What's in the game

- **Rules.** Chukkers with a running clock and an end-of-chukker bell. Teams change ends after every goal and restart with an umpire throw-in. A tie after the last chukker goes to a golden-goal extra chukker. The rider following the **line of the ball** has right of way: cutting across in front of them is a foul, while shoulder-to-shoulder ride-offs are legal. Fouls give free hits (Penalty 2 or 5 depending on where the foul happened).
- **AI.** Riders play roles (No.1 forward, No.2 support, Back). Each team picks a chaser by time-to-ball, and the chaser approaches with the ball on its off-side and times forehands, near-side shots and backhands. The AI passes to open teammates and rides parallel to the line of the ball instead of crossing it. Three difficulty levels: Novice, Club and High-goal.
- **Ponies.** Gait-correct procedural animation: 4-beat walk, diagonal trot, rotary canter/gallop. Each pony has a hogged mane, a taped-up tail and team-colour leg wraps. Stamina drains when sprinting and resets with a fresh pony each chukker.
- **VFX.**
  - Hoof-strike dust and turf kicks timed to the footfalls.
  - Mallet impacts with sparks, a shockwave ring and a turf divot that leaves a ground decal.
  - A speed-scaled ball trail.
  - Goal celebrations with fireworks, confetti, a cheering crowd and a net bulge.
  - Waving flags and an animated crowd driven by vertex shaders.
- **Audio.** All sound is synthesised in WebAudio and positioned in 3D (HRTF): hoofbeats, the mallet "tock", board thuds, the umpire's pea whistle, the chukker bell and a reactive crowd.
- **VR comfort.** A tunnel vignette appears on turns and acceleration. There is no camera shake and no forced pitch or roll in VR. You can recentre your seat height, and the mallet shaft is lengthened so you can reach the ball while seated.

## Project layout

```
src/
  config.js            tuning constants (arena, ball, gaits, mallet, teams, difficulty)
  game/ball.js         ball physics (drag, bounce, rolling, boards, goal mouths)
  game/rider.js        pony locomotion + mallet swing kinematics + swept hit detection
  game/rules.js        match flow, line of the ball / right of way, fouls, penalties
  game/ai.js           role-based riders
  game/sim.js          the complete rendering-free match simulation (shared by game and tests)
  game/game.js         visuals/audio/input/camera layer over the Sim
  render/post.js       desktop post-processing chain
  entities/loft.js     lofted organic meshes + procedural hair normal map
  entities/            procedural pony/rider/mallet models + gait animation
  world/arena.js       field shader, boards, goals, stands, crowd, sky, scoreboard
  vfx/vfx.js           particle pools, ball trail, shockwaves, decals, confetti, fireworks
  audio/audio.js       procedural sound
  xr/xr.js             Quest rig: tracked mallet, reins, vignette, haptics, in-headset HUD
  sim/headless.js      AI-vs-AI runner on the shared Sim (tests and balancing)
tests/                 node:test unit tests and an AI-vs-AI full-match test
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes a static bundle to `dist/`.

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the design notes and roadmap, and [docs/PLAYTEST_REPORT.md](docs/PLAYTEST_REPORT.md) for the playtest critique and the fixes it led to.

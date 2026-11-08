# Playtest report: critique and fixes

I played the build from start to finish. Because the sandbox only has software rendering, a scripted "skilled human" bot drove the real in-browser `Game`, and I took rendered screenshots at key moments. The Node harnesses for these checks now live in `tests/gameplay.test.js` and `tests/sim.test.js`.

## Measured before / after

| Metric (one full match, Club) | Before | After |
|---|---|---|
| Fouls whistled in a match with a human player | **34** | ~8 |
| Fouls committed by the human (charging the ball) | 19 | 2–3 |
| Swing contact rate when you swing on the cue | 22–36% | 54–62% |
| Goals per AI-vs-AI match (Club) | 16–23, often within seconds of a restart | ~12 |
| Riders ending up outside the arena | Yes, after collisions near the boards | Never (asserted in tests) |
| Ball "dead-sticking" on landing | ~3% of landings | Fixed |

## Gameplay faults found → fixes

1. **Whistle-fest.** Every bump at an angle above 45° and 7.5 m/s was called "dangerous riding", and the referee often blamed the wrong rider.
   - *Fix:* fouls are now judged on who was driving into whom along the contact normal, at above 6.5 m/s and an angle above 75°. The right-of-way holder can never be penalised. Ordinary bumps just thud.
2. **The AI rode through people.** *Fix:* predictive collision avoidance (closest-approach time). Riders steer off and check their speed, but parallel ride-offs are still allowed.
3. **Humans were punished for charging the ball.** *Fix:* "pony sense". Real ponies refuse to T-bone another horse, so the player's pony now checks and eases away when a side-on collision is under 0.7 s away.
4. **Hitting felt random.** The swing takes about 0.45 s from wind-up to contact, but the cue ignored that.
   - *Fix 1:* a **time-to-contact strike lane** under the ball: yellow means coming up, green means swing now.
   - *Fix 2:* **swing assist** (on by default, can be switched off in the menu) holds your release for up to 0.4 s to meet the ball.
   - *Fix 3:* riders **lean in or out of the saddle** to meet the ball. The human can lean ±0.7 m; AI riders lean less depending on skill.
5. **You couldn't tell which line not to cross.** *Fix:* the line of the ball is drawn on the turf: dashed, red when the opponents have right of way, gold when it's yours. After your first crossing foul, a hint explains the rule.
6. **The free-hit was pointless.** Defenders swarmed after 1.2 s. *Fix:* opponents wait until the ball is struck, with an 8 s timeout. When it's your hit, your gait is preset to a canter.
7. **Gears felt clunky.** You had to tap W four times from every throw-in. *Fix:* hold W/S to step through the gaits, and Shift from a standstill means go.
8. **Teammates ignored you.** *Fix:* **E** (or B on a gamepad) calls for the ball, and the teammate who reaches it first leads a pass to where you're heading.
9. **Losing the ball.** *Fix:* an arrow at the screen edge points to the ball when it's off screen, the chase camera swings toward the ball more strongly, and the camera is clamped so it never clips into the stands.
10. **The goal moment was flat.** *Fix:* a cinematic low goal cam during the celebration, plus "Big hit!", "Tap" and "Ride-off!" feedback flashes.
11. **The HUD lied.** It showed "Canter · 0 km/h" while you were frozen at a throw-in. *Fix:* it shows the gait the pony is actually in and the gait you've asked for.
12. **Esc didn't pause** in pointer-lock mode, because the browser swallows the key. *Fix:* losing pointer lock in the middle of a match pauses the game.
13. **The arena ball travelled about 200 m.** *Fix:* softer arena-ball physics. AI riders now dribble from range, shoot hard near goal, and have accuracy that drops with distance. The Back keeps goal when the ball is within 38 m. Penalty 2 is taken from 27 m under pressure.
14. **Ball stuck dead on landing.** A falling ball that landed within 1 mm of the turf on a frame boundary was treated as rolling. *Fix:* it now bounces.
15. **Riders escaped the arena.** Collision pushes happened after the boards were enforced. *Fix:* riders are confined after collisions.
16. **Tests didn't test the game.** The headless match skipped pony collisions, so it never saw the foul spam. *Fix:* one shared `Sim` class is used by both the game and the tests.

## Visual faults found → fixes

| Fault | Fix |
|---|---|
| Ponies were capsules and sticks | Lofted anatomical bodies: hindquarters, barrel, withers, arched neck, head with jowl, and shoulder and hip muscle masses. Jointed legs with forearm, knee, cannon, fetlock, pastern and hoof; hind legs have gaskin and hock. |
| Coats looked like plastic, then like carved wood | Physically based coat with sheen and a subtle hair-direction normal map. Dark points on bays, socks and blazes. |
| White boxes for saddle and pad | Saddle, numnah and flaps shaped as shells that follow the barrel. Girth, breastplate, bridle, bit, stirrups, reins and taped tail. |
| Riders were mannequins with locked straight arms | Shaped torso, helmet with peak and face-guard, knee guards and tall boots. Two-bone IK arms on the reins and mallet. The mallet is carried upright with the elbow bent between swings, and the rider leans out when striking. |
| Gradient sky with no clouds | Physically based (Preetham) sky at golden hour, a drifting cloud layer, and image-based lighting generated from the sky. |
| Flat field texture with a giant logo | Natural turf mottling, subtle mowing stripes, chewed goal mouths and centre, painted lines with scuffs, and **300k real 3D grass blades** that wrap around the camera and move in the wind. |
| Capsule crowd | Seated spectators with skin tones, trousers, sun-hats, seat rows, rails and steel stand roofs. |
| Blob trees | Clustered canopy lobes with baked AO, plus poplars, instanced, and rolling hills on the horizon. |
| No post-processing | On desktop: MSAA, ground-truth ambient occlusion (GTAO), subtle bloom, ACES tone mapping and a film grade. Off in VR. |
| Dust blobs on the lens | Particles fade out near the camera. |

## Performance tiers

The Meta Quest Browser automatically uses the `low` tier, or you can force it with `?quality=low`. The low tier:

- uses no post-processing;
- uses 50k grass blades;
- uses 1k shadows and 2k turf;
- uses a standard rather than physical coat material;
- uses a low-poly crowd.

That comes to about **290 draw calls and 430k triangles**. These figures still need on-headset profiling (OVR Metrics Tool).

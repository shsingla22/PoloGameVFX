# Game design notes

## Pillars
1. **Authentic polo.** The line of the ball, right of way, ride-offs, off-side and near-side shots, changing ends, chukkers and fresh ponies.
2. **The swing feels great.** In VR you swing your real arm. On desktop you hold to wind up and release to strike. Every hit has a sound, haptics and VFX.
3. **Comfortable in VR.** The player sits in a stable "saddle cockpit" frame. A vignette appears on turns and acceleration, the camera never shakes, and the frame rate comes first.

## Why arena polo first
A full polo field is about 275 × 145 m. That is too much empty space for a short VR session, and it costs a lot of draw distance. Arena polo is 3 v 3 in a walled arena of about 90 × 46 m. That keeps the action dense, makes the boards part of play, and suits Quest performance. Field polo (4 v 4) is on the roadmap.

## Rules model (simplified HPA/USPA)
- **Line of the ball (LOB):** the ball's current direction of travel. Right of way (ROW) belongs to the last hitter while they keep following the line. ROW lapses if they turn away.
- **Crossing:** an opponent cutting across the line within about 9 m in front of the ROW holder, who is moving at speed. Meeting the ball head-on, or riding parallel to the line, is legal.
- **Dangerous riding:** a side-on collision (angle over 45°) at a relative speed above 7.5 m/s. A parallel collision is a legal ride-off.
- **Penalties:** a foul in the offending team's defensive third gives a Penalty 2 from the 25 m spot. Anywhere else gives a Penalty 5, a free hit from the spot of the foul. Defending players must give 9 m clearance.

## Performance budget (Quest 3, 72–90 Hz)
- The `low` tier is chosen automatically in the Quest Browser. It comes to about 290 draw calls and 430k triangles: ponies merged per animated segment, an instanced crowd, trees and decals, 50k grass blades, a standard coat material and no post-processing.
- The desktop `high` tier adds MSAA, GTAO, bloom, a film grade, 4k shadows, 300k grass blades and a physical coat with sheen.
- Settle these figures with on-device profiling (OVR Metrics Tool / Meta Runtime Optimizer).

## Roadmap
- **Phase 2:** field polo mode (4 v 4, full-size ground), hooks (mallet-on-mallet blocking), meeting shots, more penalty types, umpire calls with replays.
- **Phase 3:** career mode with a handicap from −2 to 10, a pony string with temperaments, venues (snow polo, beach, night under lights).
- **Phase 4:** online multiplayer (host-authoritative ball, predicted riders), voice chat, leaderboards.
- **Art pass:** replace procedural ponies and riders with rigged, motion-captured models (glTF + KTX2), and add baked lighting per venue.
- **Native Quest build:** port the systems to Unity + Meta XR SDK if Horizon Store distribution is needed. The sim, rules and AI are written engine-agnostically for this reason.

// Global tuning constants. Units: metres, seconds, radians.
// World axes: +X runs toward the "east" goal, +Z across the arena, +Y up.

export const ARENA = {
  length: 90,          // arena polo: ~100 x 50 yards
  width: 46,
  boardHeight: 1.25,
  goalWidth: 9.1,      // 10 yards
  goalHeight: 3.4,
  goalDepth: 2.2,
};

export const MATCH = {
  chukkers: 4,
  chukkerSeconds: 150,   // real chukkers are 7 min; shortened for play
  goalCelebration: 4.0,
  throwInDelay: 2.6,
  foulDelay: 2.8,
  breakSeconds: 4.5,
  freeHitClearance: 9,   // opponents must be this far from a penalty hit
};

export const BALL = {
  radius: 0.075,         // arena ball is larger & softer than the field ball
  gravity: 9.81,
  restitutionGround: 0.48,
  restitutionBoards: 0.62,
  rollingDecel: 2.3,     // m/s^2 on grass
  airDrag: 0.012,        // quadratic drag coefficient
  maxSpeed: 32,
};

// Gait speed bands (m/s). Polo ponies gallop at up to ~55 km/h.
export const GAITS = [
  { name: 'Halt',   speed: 0 },
  { name: 'Walk',   speed: 1.8 },
  { name: 'Trot',   speed: 4.2 },
  { name: 'Canter', speed: 8.5 },
  { name: 'Gallop', speed: 13.5 },
];

export const HORSE = {
  sprintSpeed: 16.0,
  accel: 6.5,
  brake: 11.0,
  turnRateSlow: 2.4,     // rad/s at walk
  turnRateFast: 1.05,    // rad/s at full gallop
  radius: 1.15,          // collision radius (body ~2.4m long)
  mass: 480,
  staminaDrain: 0.11,    // per second while sprinting
  staminaRegen: 0.05,
  saddleHeight: 1.62,
  eyeHeight: 2.45,
};

export const MALLET = {
  reach: 2.35,           // shoulder -> head (arm + 1.3 m mallet)
  headRadius: 0.16,
  shoulderHeight: 2.25,
  shoulderSide: 0.32,
  swingDuration: 0.36,
  recover: 0.35,
  vrShaft: 1.85,         // VR: extended "reach-assisted" shaft
  vrMinHitSpeed: 2.2,
};

export const TEAMS = [
  { id: 0, name: 'Riders Gang', short: 'RGP', color: 0x1f5fd6, accent: 0xf2f4f8, wrap: 0x2c7bff },
  { id: 1, name: 'Desert Hawks', short: 'DHK', color: 0xc8202f, accent: 0xffd34d, wrap: 0xff4455 },
];

export const DIFFICULTY = {
  novice:   { label: 'Novice (−2 goal)', skill: 0.35, reaction: 0.55, speedMul: 0.86 },
  club:     { label: 'Club (4 goal)',    skill: 0.6,  reaction: 0.32, speedMul: 0.95 },
  highgoal: { label: 'High-goal (8)',    skill: 0.88, reaction: 0.16, speedMul: 1.0 },
};

export const SIM_DT = 1 / 120;

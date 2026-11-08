// Headless match runner: the exact same Sim the game uses, with every rider (including
// the human's) driven by AI. Used by tests and for balance tuning.
import { Sim } from '../game/sim.js';
import { SIM_DT } from '../config.js';

export function runHeadlessMatch({ seconds = 900, chukkers = 4, chukkerSeconds = 150, difficulty = 'club', playerIsAI = true, onStep } = {}) {
  const sim = new Sim({ difficulty, chukkers, chukkerSeconds, playerIsAI });
  const log = [];
  sim.match.on((t, d) => log.push({ t, time: sim.match.time, ...d }));
  sim.start();
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps && sim.match.state !== 'fulltime'; i++) {
    if (onStep) onStep(sim);
    sim.step(SIM_DT);
  }
  return { sim, match: sim.match, log, time: sim.time };
}

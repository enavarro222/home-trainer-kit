/**
 * Virtual gears, for trainers with a single cog (Zwift Cog and the like):
 * the game shifts by changing what it asks of the trainer.
 *
 * A virtual gear k times bigger than the real one moves the bike k times
 * faster at the same cadence; for the pedals to feel it, the trainer must
 * resist at its own speed v with k·F(k·v), F being the road's resistance
 * (crank torque = force × ratio × wheel radius). With the FTMS road model
 * F(v) = m·g·(grade + Crr) + Cw·v², that is: grade × k, Crr × k, Cw × k³.
 * On a trainer with a real cassette, the gear stays 1: nothing changes.
 */

/** The road's resistance, as FTMS simulation sends it. */
export interface Road {
  /** Rolling resistance coefficient. */
  readonly rolling: number;
  /** Wind resistance coefficient, ½·ρ·CdA, kg/m. */
  readonly airDrag: number;
}

export const DEFAULT_ROAD: Road = { rolling: 0.004, airDrag: 0.5 * 1.2 * 0.32 };

/** The simulation parameters for a slope in a virtual gear (1: none). */
export function gearedSimulation(
  gradePercent: number,
  road: Road,
  gear: number,
): { gradePercent: number; rolling: number; airDrag: number } {
  return {
    gradePercent: gradePercent * gear,
    rolling: road.rolling * gear,
    // FTMS caps it at 2.55: with Cw ≈ 0.19, reached past k ≈ 2.37, above the table's top.
    airDrag: road.airDrag * gear ** 3,
  };
}

/**
 * Trainers without simulation only take a resistance level, drawn from a
 * slope: a rough stand-in, the flat itself counting as about this slope
 * (air and rolling at ~30 km/h), scaled with the gear like the rest.
 */
export const FLAT_EQUIVALENT_PERCENT = 3;

export const gearedResistanceSlope = (percent: number, gear: number): number =>
  percent * gear + (gear - 1) * FLAT_EQUIVALENT_PERCENT;

/** Virtual gear ratios (chainring ÷ cog), easiest first: 24, as on Zwift, 0.75 to 5.49. */
export const VIRTUAL_RATIOS: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => 0.75 * (5.49 / 0.75) ** (i / 23),
);

/** The real drivetrain: chainring and cog teeth. */
export interface Drivetrain {
  readonly chainring: number;
  readonly cog: number;
}

/** A starting guess (ratio 2.4): the rider sets their own. */
export const DEFAULT_DRIVETRAIN: Drivetrain = { chainring: 34, cog: 14 };

export const realRatio = (d: Drivetrain): number => (d.cog > 0 ? d.chainring / d.cog : 1);

/** The virtual gear closest to the real one: where a ride starts, and it feels as without gears. */
export function neutralGear(d: Drivetrain): number {
  const real = realRatio(d);
  let best = 0;
  VIRTUAL_RATIOS.forEach((r, i) => {
    if (Math.abs(Math.log(r / real)) < Math.abs(Math.log((VIRTUAL_RATIOS[best] ?? r) / real)))
      best = i;
  });
  return best;
}

/** The factor sent to the trainer for virtual gear `index` (see gearedSimulation). */
export const gearFactor = (index: number, d: Drivetrain): number =>
  (VIRTUAL_RATIOS[Math.min(VIRTUAL_RATIOS.length - 1, Math.max(0, index))] ?? 1) / realRatio(d);

/** One gear up (+1, harder) or down (−1), within the table. */
export const shift = (index: number, by: 1 | -1): number =>
  Math.min(VIRTUAL_RATIOS.length - 1, Math.max(0, index + by));

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRIVETRAIN,
  DEFAULT_ROAD,
  VIRTUAL_RATIOS,
  gearFactor,
  gearedResistanceSlope,
  gearedSimulation,
  neutralGear,
  realRatio,
  shift,
} from "./gears";

/** FTMS road force at speed v, N (83 kg). */
const force = (sim: { gradePercent: number; rolling: number; airDrag: number }, v: number) =>
  83 * 9.81 * (sim.gradePercent / 100 + sim.rolling) + sim.airDrag * v * v;

describe("gearedSimulation", () => {
  it("leaves everything as is in gear 1", () => {
    expect(gearedSimulation(5, DEFAULT_ROAD, 1)).toEqual({
      gradePercent: 5,
      rolling: DEFAULT_ROAD.rolling,
      airDrag: DEFAULT_ROAD.airDrag,
    });
  });

  it("makes the trainer resist with k·F(k·v): the pedals feel the virtual gear", () => {
    for (const k of [0.4, 1.3, 2.2]) {
      for (const v of [4, 8, 12]) {
        const plain = gearedSimulation(4, DEFAULT_ROAD, 1);
        const geared = gearedSimulation(4, DEFAULT_ROAD, k);
        expect(force(geared, v)).toBeCloseTo(k * force(plain, k * v), 6);
      }
    }
  });

  it("stays within FTMS's wind coefficient up to the table's top gear", () => {
    const top = gearFactor(VIRTUAL_RATIOS.length - 1, DEFAULT_DRIVETRAIN);
    expect(gearedSimulation(0, DEFAULT_ROAD, top).airDrag).toBeLessThan(2.55);
  });
});

describe("gears", () => {
  it("has 24 ratios, easiest first, from 0.75 to 5.49", () => {
    expect(VIRTUAL_RATIOS).toHaveLength(24);
    expect(VIRTUAL_RATIOS[0]).toBeCloseTo(0.75);
    expect(VIRTUAL_RATIOS[23]).toBeCloseTo(5.49);
  });

  it("starts in the gear closest to the real one, so it feels as without gears", () => {
    const n = neutralGear(DEFAULT_DRIVETRAIN);
    expect(gearFactor(n, DEFAULT_DRIVETRAIN)).toBeCloseTo(1, 1);
    expect(realRatio({ chainring: 34, cog: 17 })).toBe(2);
  });

  it("shifts one gear at a time, within the table", () => {
    expect(shift(5, 1)).toBe(6);
    expect(shift(0, -1)).toBe(0);
    expect(shift(23, 1)).toBe(23);
  });

  it("makes resistance-only trainers harder in a bigger gear, even on the flat", () => {
    expect(gearedResistanceSlope(0, 1)).toBe(0);
    expect(gearedResistanceSlope(0, 1.5)).toBeGreaterThan(0);
    expect(gearedResistanceSlope(4, 0.5)).toBeLessThan(4);
  });
});

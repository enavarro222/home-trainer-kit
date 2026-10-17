export interface SensorReading {
  /** Pedal turns per minute. */
  cadence: number;
  /** Watts. */
  power: number;
}

/** Anything that measures pedaling. The game polls it once per frame. */
export interface Sensor {
  readonly kind: "bluetooth" | "demo";
  read(nowMs: number): SensorReading;
  /** Whether it measures power, as far as can be told so far. */
  measuresPower(): boolean;
  /** Called before each ride so a stale value does not leak into it. */
  reset(): void;
  disconnect(): void;
  /**
   * Sets the trainer's slope, in percent, when it can be controlled.
   * Resolves to false when it cannot or refused; never rejects.
   */
  setSlope?(percent: number): Promise<boolean>;
  /**
   * Shifts to a virtual gear: the factor from gears.gearFactor, 1 for none.
   * Resends the current slope at once. Same contract as setSlope.
   */
  setGear?(gear: number): Promise<boolean>;
}

export const ZERO_READING: SensorReading = { cadence: 0, power: 0 };

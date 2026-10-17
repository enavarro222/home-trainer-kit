import type { Sensor, SensorReading } from "../types";

export type Foot = "left" | "right";

/** The cadence the fastest tapping tends to, without ever reaching it. */
export const MAX_DEMO_CADENCE = 180;
/**
 * Steps per second where the curve starts to flatten. Tapping is much easier
 * than pedaling: 7 presses a second are nothing for fingers. With this curve
 * 4 steps/s give ~70 rpm, 6 ~100, 8 ~120 and 12 only ~150.
 */
const EASE_STEPS_PER_SEC = 10;
/** Without a step for this long, the pedals have stopped. */
export const STOP_AFTER_MS = 1500;
/** Weight of the latest step in the cadence, to smooth irregular tapping. */
const SMOOTHING = 0.5;
const WATTS_PER_RPM = 1.6;

/** Cadence for a rhythm of one step every `intervalMs`, with diminishing returns. */
export function cadenceFor(intervalMs: number): number {
  return MAX_DEMO_CADENCE * Math.tanh(1000 / intervalMs / EASE_STEPS_PER_SEC);
}

/**
 * Pedaling without a bike: the player presses left and right in turn (arrow
 * keys, or two buttons on a touch screen). The cadence follows their rhythm, up to a point;
 * pressing the same side twice does not count.
 */
export class DemoSensor implements Sensor {
  readonly kind = "demo";
  private cadence = 0;
  private lastFoot: Foot | null = null;
  private lastStepMs: number | null = null;

  step(foot: Foot, nowMs: number): void {
    if (foot === this.lastFoot) return;
    if (this.lastStepMs !== null && nowMs > this.lastStepMs) {
      const instant = cadenceFor(nowMs - this.lastStepMs);
      this.cadence =
        this.cadence === 0 ? instant : SMOOTHING * instant + (1 - SMOOTHING) * this.cadence;
    }
    this.lastFoot = foot;
    this.lastStepMs = nowMs;
  }

  read(nowMs: number): SensorReading {
    if (this.lastStepMs === null) return { cadence: 0, power: 0 };
    const idleMs = nowMs - this.lastStepMs;
    if (idleMs > STOP_AFTER_MS) this.cadence = 0;
    // Slowing down: a step late for the current rhythm lowers the cadence
    // right away, without waiting for it.
    else if (idleMs > 0) this.cadence = Math.min(this.cadence, cadenceFor(idleMs));
    return { cadence: this.cadence, power: this.cadence * WATTS_PER_RPM };
  }

  /** Watts are made up from the cadence, but they are there. */
  measuresPower(): boolean {
    return true;
  }

  reset(): void {
    this.cadence = 0;
    this.lastFoot = null;
    this.lastStepMs = null;
  }

  disconnect(): void {
    this.reset();
  }
}

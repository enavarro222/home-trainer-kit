// Setting an FTMS trainer's slope through its Control Point (0x2AD9): as a
// simulated grade, or as a resistance level on trainers without simulation.
// Byte encoding and decoding are pure functions; FtmsControl does the
// request/response dance over a GATT characteristic.

import type { Road } from "../gears";
import { DEFAULT_ROAD, gearedResistanceSlope, gearedSimulation } from "../gears";

export const OP_REQUEST_CONTROL = 0x00;
export const OP_SET_RESISTANCE = 0x04;
export const OP_START = 0x07;
export const OP_SET_SIMULATION = 0x11;
const RESPONSE_CODE = 0x80;

export const RESULT_SUCCESS = 0x01;
export const RESULT_CONTROL_NOT_PERMITTED = 0x05;

/** Target setting feature bits. */
const RESISTANCE_TARGET_SUPPORTED = 1 << 2;
const SIMULATION_SUPPORTED = 1 << 13;

export interface ResistanceRange {
  /** In the trainer's own units (0.1 resolution in FTMS). */
  min: number;
  max: number;
  increment: number;
}

/** Elite Suito's range, used when a trainer does not publish its own. */
export const DEFAULT_RANGE: ResistanceRange = { min: 0, max: 200, increment: 1 };

/**
 * Share of the trainer's resistance range per percent of slope, on trainers
 * without simulation. Calibrated on an Elite Suito with an 8-year-old:
 * 0 → spins above 90 rpm, 10 (2 %) → about 85 rpm, 25 (5 %) → about 65 rpm.
 * 50 (10 %) stopped an adult within seconds: a challenge for grown-ups.
 */
export const RESISTANCE_SHARE_PER_PERCENT = 0.025;

/** What the game can set on a trainer, from its Fitness Machine Feature (0x2ACC). */
export function controlFeatures(feature: DataView): { simulation: boolean; resistance: boolean } {
  const targets = feature.byteLength < 8 ? 0 : feature.getUint32(4, true);
  return {
    simulation: (targets & SIMULATION_SUPPORTED) !== 0,
    resistance: (targets & RESISTANCE_TARGET_SUPPORTED) !== 0,
  };
}

/** Supported Resistance Level Range (0x2AD6). */
export function parseResistanceRange(view: DataView): ResistanceRange | null {
  if (view.byteLength < 6) return null;
  const range = {
    min: view.getInt16(0, true),
    max: view.getInt16(2, true),
    increment: view.getUint16(4, true),
  };
  return range.max > range.min && range.increment > 0 ? range : null;
}

export function resistanceLevel(slopePercent: number, range: ResistanceRange): number {
  const share = Math.min(1, Math.max(0, slopePercent * RESISTANCE_SHARE_PER_PERCENT));
  const raw = range.min + (range.max - range.min) * share;
  const stepped = range.min + Math.round((raw - range.min) / range.increment) * range.increment;
  // The FTMS 1.0 parameter is a UINT8.
  return Math.min(255, Math.max(0, Math.min(range.max, stepped)));
}

export const encodeSetResistance = (level: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array([OP_SET_RESISTANCE, level]);

/**
 * Indoor Bike Simulation Parameters: no wind, the grade, Crr, wind
 * coefficient. The road is the game's own model, so the legs feel what the
 * screen shows; `gear` is a virtual gear (see gears.ts), 1 for none.
 */
export function encodeSetSimulation(
  gradePercent: number,
  road: Road = DEFAULT_ROAD,
  gear = 1,
): Uint8Array<ArrayBuffer> {
  const sim = gearedSimulation(gradePercent, road, gear);
  const bytes = new Uint8Array(7);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, OP_SET_SIMULATION);
  view.setInt16(1, 0, true); // wind speed, 0.001 m/s
  const grade = Math.round(sim.gradePercent * 100); // 0.01 %
  view.setInt16(3, Math.min(0x7fff, Math.max(-0x8000, grade)), true);
  view.setUint8(5, Math.min(255, Math.round(sim.rolling * 10_000))); // 0.0001
  view.setUint8(6, Math.min(255, Math.round(sim.airDrag * 100))); // 0.01 kg/m
  return bytes;
}

/** How a trainer renders a slope: simulated grade on a road, or a resistance level. */
export type SlopeMode =
  { kind: "simulation"; road?: Road } | { kind: "resistance"; range: ResistanceRange };

/** Control Point indication: [0x80, request op code, result code]. */
export function parseControlResponse(view: DataView): { opCode: number; result: number } | null {
  if (view.byteLength < 3 || view.getUint8(0) !== RESPONSE_CODE) return null;
  return { opCode: view.getUint8(1), result: view.getUint8(2) };
}

/** What FtmsControl needs from a GATT characteristic; lets tests use a fake. */
export interface ControlPoint {
  writeValueWithResponse(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: () => void): void;
  readonly value?: DataView;
}

export const RESPONSE_TIMEOUT_MS = 3000;

export class FtmsControl {
  private hasControl = false;
  private pending: ((result: number) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private slope = 0;
  /** How the slope reaches the trainer. */
  readonly kind: SlopeMode["kind"];
  private gear = 1;

  constructor(
    private readonly controlPoint: ControlPoint,
    private readonly mode: SlopeMode,
  ) {
    this.kind = mode.kind;
    controlPoint.addEventListener("characteristicvaluechanged", () => {
      const response = controlPoint.value && parseControlResponse(controlPoint.value);
      if (response) this.pending?.(response.result);
    });
  }

  /**
   * Sets the slope, in percent; resolves to false if the trainer refused or
   * did not answer. Never rejects: a trainer that cannot be controlled just
   * keeps its current setting.
   */
  setSlope(percent: number): Promise<boolean> {
    this.slope = percent;
    return this.apply();
  }

  /**
   * Shifts to a virtual gear (virtual ÷ real ratio, 1 for none), resending
   * the current slope at once: the legs feel the shift straight away.
   */
  setGear(gear: number): Promise<boolean> {
    this.gear = gear;
    return this.apply();
  }

  private apply(): Promise<boolean> {
    const percent = this.slope;
    const gear = this.gear;
    const run = async () => {
      try {
        if (!this.hasControl && !(await this.takeControl())) return false;
        const payload =
          this.mode.kind === "simulation"
            ? encodeSetSimulation(percent, this.mode.road, gear)
            : encodeSetResistance(
                resistanceLevel(gearedResistanceSlope(percent, gear), this.mode.range),
              );
        let result = await this.send(payload);
        // Another app took over meanwhile: ask again once.
        if (result === RESULT_CONTROL_NOT_PERMITTED && (await this.takeControl())) {
          result = await this.send(payload);
        }
        return result === RESULT_SUCCESS;
      } catch {
        return false;
      }
    };
    // Commands go one at a time: responses do not say which write they answer.
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  private async takeControl(): Promise<boolean> {
    this.hasControl = (await this.send(new Uint8Array([OP_REQUEST_CONTROL]))) === RESULT_SUCCESS;
    // Some trainers only apply targets once "started"; others refuse it: ignore.
    if (this.hasControl) await this.send(new Uint8Array([OP_START]));
    return this.hasControl;
  }

  private send(payload: Uint8Array<ArrayBuffer>): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        resolve(-1);
      }, RESPONSE_TIMEOUT_MS);
      this.pending = (result) => {
        clearTimeout(timer);
        this.pending = null;
        resolve(result);
      };
      this.controlPoint.writeValueWithResponse(payload).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

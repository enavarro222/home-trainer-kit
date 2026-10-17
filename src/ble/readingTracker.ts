import { ZERO_READING, type SensorReading } from "../types";
import { type CrankSample, crankCadence, type ParsedData } from "./parsers";

/**
 * Without a notification for this long, the bike is considered stopped (or
 * gone): the last value must not keep scoring points.
 */
export const STALE_AFTER_MS = 3000;

/**
 * Crank sensors keep repeating the last sample when the pedals stop. No new
 * revolution for this long (i.e. under 30 rpm) means stopped.
 */
export const CRANK_STOPPED_AFTER_MS = 2000;

/** Latest reading built from successive Bluetooth notifications. */
export class ReadingTracker {
  private reading: SensorReading = ZERO_READING;
  private lastCrank: CrankSample | null = null;
  private lastUpdateMs = Number.NEGATIVE_INFINITY;
  private lastRevolutionMs = Number.NEGATIVE_INFINITY;
  // Kept across resets: they describe the sensor, not a ride.
  private powerSent = false;
  private pedaledWithoutPower = false;
  private powerSeen = false;

  update(data: ParsedData, nowMs: number): void {
    let { cadence } = this.reading;
    if (data.cadence !== undefined) {
      cadence = data.cadence;
    } else if (data.crank) {
      if (data.crank.revolutions !== this.lastCrank?.revolutions) this.lastRevolutionMs = nowMs;
      if (this.lastCrank) cadence = crankCadence(this.lastCrank, data.crank, cadence);
      this.lastCrank = data.crank;
    }
    this.reading = { cadence, power: data.power ?? this.reading.power };
    this.lastUpdateMs = nowMs;
    if (data.power !== undefined) this.powerSent = true;
    if (this.reading.power > 0) this.powerSeen = true;
    else if (cadence > 0) this.pedaledWithoutPower = true;
  }

  /**
   * Power is measured if the sensor sends it, unless pedaling never moved it
   * from 0: some trainers send the field without measuring anything.
   */
  measuresPower(): boolean {
    return this.powerSent && (this.powerSeen || !this.pedaledWithoutPower);
  }

  read(nowMs: number): SensorReading {
    if (nowMs - this.lastUpdateMs > STALE_AFTER_MS) return ZERO_READING;
    if (this.lastCrank && nowMs - this.lastRevolutionMs > CRANK_STOPPED_AFTER_MS) {
      return { ...this.reading, cadence: 0 };
    }
    return this.reading;
  }

  reset(): void {
    this.reading = ZERO_READING;
    this.lastCrank = null;
    this.lastUpdateMs = Number.NEGATIVE_INFINITY;
    this.lastRevolutionMs = Number.NEGATIVE_INFINITY;
  }
}

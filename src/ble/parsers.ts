// Decoding of the Bluetooth fitness characteristics. Pure functions over the
// raw bytes, so they are testable with captured frames. All values are
// little-endian. A truncated frame yields whatever fields fit, never throws.

export interface CrankSample {
  /** Cumulative crank revolutions (wraps at 65536). */
  revolutions: number;
  /** Time of the last crank event, in 1/1024 s (wraps at 65536). */
  eventTime: number;
}

export interface ParsedData {
  cadence?: number;
  power?: number;
  crank?: CrankSample;
}

export const MAX_CADENCE = 220;

class Reader {
  offset: number;
  constructor(
    private readonly view: DataView,
    start: number,
  ) {
    this.offset = start;
  }
  private fits(bytes: number) {
    return this.offset + bytes <= this.view.byteLength;
  }
  skip(bytes: number) {
    this.offset += bytes;
  }
  uint16(): number | undefined {
    if (!this.fits(2)) return undefined;
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  int16(): number | undefined {
    if (!this.fits(2)) return undefined;
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }
  crank(): CrankSample | undefined {
    if (!this.fits(4)) return undefined;
    const revolutions = this.view.getUint16(this.offset, true);
    const eventTime = this.view.getUint16(this.offset + 2, true);
    this.offset += 4;
    return { revolutions, eventTime };
  }
}

const withoutUndefined = (data: ParsedData): ParsedData =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

/**
 * FTMS Indoor Bike Data (0x2AD2).
 *
 * Trap: flag bit 0 is "More Data", and it is inverted compared to every other
 * bit — instantaneous speed is present when bit 0 is 0.
 */
export function parseIndoorBikeData(view: DataView): ParsedData {
  if (view.byteLength < 2) return {};
  const flags = view.getUint16(0, true);
  const r = new Reader(view, 2);
  if (!(flags & 0x0001)) r.skip(2); // instantaneous speed
  if (flags & 0x0002) r.skip(2); // average speed
  const rawCadence = flags & 0x0004 ? r.uint16() : undefined;
  if (flags & 0x0008) r.skip(2); // average cadence
  if (flags & 0x0010) r.skip(3); // total distance (uint24)
  if (flags & 0x0020) r.skip(2); // resistance level
  const power = flags & 0x0040 ? r.int16() : undefined;
  return withoutUndefined({
    cadence: rawCadence === undefined ? undefined : rawCadence / 2, // 0.5 rpm resolution
    power,
  });
}

/** Cycling Power Measurement (0x2A63). */
export function parseCyclingPower(view: DataView): ParsedData {
  if (view.byteLength < 4) return {};
  const flags = view.getUint16(0, true);
  const r = new Reader(view, 2);
  const power = r.int16();
  if (flags & 0x0001) r.skip(1); // pedal power balance
  if (flags & 0x0004) r.skip(2); // accumulated torque
  if (flags & 0x0010) r.skip(6); // wheel revolution data
  const crank = flags & 0x0020 ? r.crank() : undefined;
  return withoutUndefined({ power, crank });
}

/** CSC Measurement (0x2A5B): speed/cadence sensor, no power. */
export function parseCscMeasurement(view: DataView): ParsedData {
  if (view.byteLength < 1) return {};
  const flags = view.getUint8(0);
  const r = new Reader(view, 1);
  if (flags & 0x01) r.skip(6); // wheel revolution data
  const crank = flags & 0x02 ? r.crank() : undefined;
  return withoutUndefined({ crank });
}

/**
 * Cadence from two cumulative crank samples. Sensors repeat the last sample
 * when the pedals stop, so an unchanged sample decays the previous cadence.
 */
export function crankCadence(
  prev: CrankSample,
  next: CrankSample,
  previousCadence: number,
): number {
  const revolutions = (next.revolutions - prev.revolutions + 65536) % 65536;
  const time = (next.eventTime - prev.eventTime + 65536) % 65536;
  if (time > 0) return Math.min(MAX_CADENCE, (revolutions * 60 * 1024) / time);
  return revolutions === 0 ? previousCadence * 0.8 : previousCadence;
}

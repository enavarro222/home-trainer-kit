import { describe, expect, it } from "vitest";
import {
  crankCadence,
  MAX_CADENCE,
  parseCscMeasurement,
  parseCyclingPower,
  parseIndoorBikeData,
} from "./parsers";

const bytes = (...values: number[]) => new DataView(new Uint8Array(values).buffer);
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

describe("parseIndoorBikeData (FTMS)", () => {
  it("reads speed + cadence + power, bit 0 cleared meaning speed IS present", () => {
    // flags 0x0044: cadence + power, bit 0 = 0 → speed present
    const view = bytes(...u16(0x0044), ...u16(2500), ...u16(180), ...u16(150));
    expect(parseIndoorBikeData(view)).toEqual({ cadence: 90, power: 150 });
  });

  it("reads cadence right after the flags when bit 0 is set (no speed)", () => {
    const view = bytes(...u16(0x0045), ...u16(170), ...u16(120));
    expect(parseIndoorBikeData(view)).toEqual({ cadence: 85, power: 120 });
  });

  it("skips average speed/cadence, distance and resistance", () => {
    // speed, avg speed, cadence, avg cadence, distance (3 bytes), resistance, power
    const flags = 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0020 | 0x0040;
    const view = bytes(
      ...u16(flags),
      ...u16(2500),
      ...u16(2400),
      ...u16(200),
      ...u16(190),
      1,
      2,
      3,
      ...u16(10),
      ...u16(210),
    );
    expect(parseIndoorBikeData(view)).toEqual({ cadence: 100, power: 210 });
  });

  it("reads negative power as signed", () => {
    const view = bytes(...u16(0x0041), ...u16(0xfff6));
    expect(parseIndoorBikeData(view)).toEqual({ power: -10 });
  });

  it("does not throw on truncated frames", () => {
    expect(parseIndoorBikeData(bytes())).toEqual({});
    expect(parseIndoorBikeData(bytes(...u16(0x0044), ...u16(2500), ...u16(180)))).toEqual({
      cadence: 90,
    });
  });
});

describe("parseCyclingPower", () => {
  it("reads power and crank data after the optional fields", () => {
    // balance (1) + torque (2) + wheel (6) + crank (4)
    const flags = 0x0001 | 0x0004 | 0x0010 | 0x0020;
    const view = bytes(
      ...u16(flags),
      ...u16(200),
      50,
      ...u16(0),
      ...[0, 0, 0, 0, 0, 0],
      ...u16(42),
      ...u16(1024),
    );
    expect(parseCyclingPower(view)).toEqual({
      power: 200,
      crank: { revolutions: 42, eventTime: 1024 },
    });
  });

  it("works without crank data", () => {
    expect(parseCyclingPower(bytes(...u16(0), ...u16(75)))).toEqual({ power: 75 });
  });
});

describe("parseCscMeasurement", () => {
  it("reads crank data after wheel data", () => {
    const view = bytes(0x03, ...[0, 0, 0, 0, 0, 0], ...u16(7), ...u16(2048));
    expect(parseCscMeasurement(view)).toEqual({ crank: { revolutions: 7, eventTime: 2048 } });
  });

  it("ignores wheel-only frames", () => {
    expect(parseCscMeasurement(bytes(0x01, 0, 0, 0, 0, 0, 0))).toEqual({});
  });
});

describe("crankCadence", () => {
  it("computes rpm from revolutions and 1/1024 s event times", () => {
    // 1 revolution in 0.5 s → 120 rpm
    expect(
      crankCadence({ revolutions: 10, eventTime: 0 }, { revolutions: 11, eventTime: 512 }, 0),
    ).toBe(120);
  });

  it("handles counters wrapping at 65536", () => {
    const prev = { revolutions: 65535, eventTime: 65024 };
    const next = { revolutions: 0, eventTime: 0 };
    expect(crankCadence(prev, next, 0)).toBe(120);
  });

  it("decays when the sensor repeats the same sample (pedals stopped)", () => {
    const sample = { revolutions: 5, eventTime: 100 };
    expect(crankCadence(sample, sample, 90)).toBe(72);
  });

  it("caps absurd values", () => {
    expect(
      crankCadence({ revolutions: 0, eventTime: 0 }, { revolutions: 50, eventTime: 1 }, 0),
    ).toBe(MAX_CADENCE);
  });
});

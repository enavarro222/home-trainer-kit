import { describe, expect, it } from "vitest";
import { CRANK_STOPPED_AFTER_MS, ReadingTracker, STALE_AFTER_MS } from "./ble/readingTracker";
import {
  cadenceFor,
  DemoSensor,
  type Foot,
  MAX_DEMO_CADENCE,
  STOP_AFTER_MS,
} from "./demo/demoSensor";

describe("ReadingTracker", () => {
  it("keeps the latest cadence and power", () => {
    const tracker = new ReadingTracker();
    tracker.update({ cadence: 90, power: 100 }, 0);
    tracker.update({ power: 120 }, 100);
    expect(tracker.read(100)).toEqual({ cadence: 90, power: 120 });
  });

  it("derives cadence from successive crank samples", () => {
    const tracker = new ReadingTracker();
    tracker.update({ crank: { revolutions: 0, eventTime: 0 } }, 0);
    expect(tracker.read(0).cadence).toBe(0);
    tracker.update({ crank: { revolutions: 1, eventTime: 1024 } }, 1000);
    expect(tracker.read(1000).cadence).toBe(60);
  });

  it("drops to zero when notifications stop", () => {
    const tracker = new ReadingTracker();
    tracker.update({ cadence: 90, power: 100 }, 0);
    expect(tracker.read(STALE_AFTER_MS)).toEqual({ cadence: 90, power: 100 });
    expect(tracker.read(STALE_AFTER_MS + 1)).toEqual({ cadence: 0, power: 0 });
  });

  it("drops crank cadence to zero once revolutions stop", () => {
    const tracker = new ReadingTracker();
    tracker.update({ crank: { revolutions: 0, eventTime: 0 } }, 0);
    tracker.update({ crank: { revolutions: 1, eventTime: 1024 } }, 1000);
    // The sensor keeps repeating the same sample every second.
    tracker.update({ crank: { revolutions: 1, eventTime: 1024 } }, 2000);
    expect(tracker.read(2000).cadence).toBeGreaterThan(0);
    tracker.update({ crank: { revolutions: 1, eventTime: 1024 } }, 3000);
    expect(tracker.read(1000 + CRANK_STOPPED_AFTER_MS + 1).cadence).toBe(0);
  });

  it("forgets everything on reset, including the previous crank sample", () => {
    const tracker = new ReadingTracker();
    tracker.update({ crank: { revolutions: 0, eventTime: 0 } }, 0);
    tracker.reset();
    tracker.update({ crank: { revolutions: 100, eventTime: 1024 } }, 10);
    expect(tracker.read(10).cadence).toBe(0);
  });
});

describe("ReadingTracker.measuresPower", () => {
  it("says yes once power is sent and moves", () => {
    const tracker = new ReadingTracker();
    expect(tracker.measuresPower()).toBe(false);
    tracker.update({ cadence: 0, power: 0 }, 0);
    expect(tracker.measuresPower()).toBe(true);
    tracker.update({ cadence: 80, power: 0 }, 100);
    tracker.update({ cadence: 85, power: 120 }, 200);
    tracker.reset();
    expect(tracker.measuresPower()).toBe(true);
  });

  it("says yes before any data when the protocol carries power", () => {
    // Connected, and "Let's go" before the first notification.
    const trainer = new ReadingTracker(true);
    expect(trainer.measuresPower()).toBe(true);
    // Until pedaling shows the power stuck at 0.
    trainer.update({ cadence: 80, power: 0 }, 0);
    expect(trainer.measuresPower()).toBe(false);
    trainer.update({ cadence: 85, power: 150 }, 100);
    expect(trainer.measuresPower()).toBe(true);
  });

  it("says no for cadence alone, or a power stuck at 0 while pedaling", () => {
    const cadenceOnly = new ReadingTracker();
    cadenceOnly.update({ cadence: 80 }, 0);
    expect(cadenceOnly.measuresPower()).toBe(false);

    const stuck = new ReadingTracker();
    stuck.update({ cadence: 80, power: 0 }, 0);
    expect(stuck.measuresPower()).toBe(false);
  });
});

describe("DemoSensor", () => {
  /** Alternating steps every `intervalMs`, starting at 0. */
  const pedal = (sensor: DemoSensor, intervalMs: number, steps: number, start = 0) => {
    for (let i = 0; i < steps; i++) {
      const foot: Foot = i % 2 === 0 ? "left" : "right";
      sensor.step(foot, start + i * intervalMs);
    }
    return start + (steps - 1) * intervalMs;
  };

  it("maps a relaxed rhythm to a normal cadence, a frantic one to a high one", () => {
    expect(cadenceFor(250)).toBeCloseTo(68, 0); // 4 steps/s
    expect(cadenceFor(170)).toBeCloseTo(95, 0); // ~6 steps/s
    expect(cadenceFor(125)).toBeCloseTo(120, 0); // 8 steps/s
    expect(cadenceFor(1000 / 12)).toBeCloseTo(150, 0);
    expect(cadenceFor(10)).toBeLessThanOrEqual(MAX_DEMO_CADENCE);
  });

  it("turns alternating steps into cadence and power", () => {
    const sensor = new DemoSensor();
    const last = pedal(sensor, 170, 10);
    expect(sensor.read(last).cadence).toBeCloseTo(cadenceFor(170));
    expect(sensor.read(last).power).toBeCloseTo(cadenceFor(170) * 1.6);
  });

  it("is still before the second step", () => {
    const sensor = new DemoSensor();
    expect(sensor.read(0).cadence).toBe(0);
    sensor.step("left", 0);
    expect(sensor.read(100).cadence).toBe(0);
  });

  it("ignores the same foot twice", () => {
    const sensor = new DemoSensor();
    sensor.step("left", 0);
    sensor.step("left", 100);
    sensor.step("left", 200);
    expect(sensor.read(200).cadence).toBe(0);
  });

  it("follows the rhythm, smoothly", () => {
    const sensor = new DemoSensor();
    const last = pedal(sensor, 250, 6);
    expect(sensor.read(last).cadence).toBeCloseTo(cadenceFor(250));
    sensor.step("left", last + 125); // one faster step
    expect(sensor.read(last + 125).cadence).toBeCloseTo((cadenceFor(250) + cadenceFor(125)) / 2);
  });

  it("slows down as soon as the next step is late, and stops", () => {
    const sensor = new DemoSensor();
    const last = pedal(sensor, 170, 10);
    expect(sensor.read(last + 150).cadence).toBeCloseTo(cadenceFor(170));
    expect(sensor.read(last + 1000).cadence).toBeCloseTo(cadenceFor(1000));
    expect(sensor.read(last + STOP_AFTER_MS + 1).cadence).toBe(0);
  });

  it("never goes past the maximum, even with absurd rhythms", () => {
    const sensor = new DemoSensor();
    const last = pedal(sensor, 1, 6);
    expect(sensor.read(last).cadence).toBeLessThanOrEqual(MAX_DEMO_CADENCE);
  });

  it("forgets everything on reset", () => {
    const sensor = new DemoSensor();
    const last = pedal(sensor, 170, 10);
    sensor.reset();
    expect(sensor.read(last).cadence).toBe(0);
    sensor.step("right", last + 100);
    expect(sensor.read(last + 100).cadence).toBe(0);
  });
});

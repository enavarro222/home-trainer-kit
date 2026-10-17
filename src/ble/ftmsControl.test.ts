import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ControlPoint,
  controlFeatures,
  DEFAULT_RANGE,
  encodeSetResistance,
  encodeSetSimulation,
  FtmsControl,
  OP_REQUEST_CONTROL,
  OP_SET_RESISTANCE,
  OP_SET_SIMULATION,
  OP_START,
  parseControlResponse,
  parseResistanceRange,
  RESPONSE_TIMEOUT_MS,
  RESULT_CONTROL_NOT_PERMITTED,
  RESULT_SUCCESS,
  resistanceLevel,
  type SlopeMode,
} from "./ftmsControl";

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
const RESISTANCE: SlopeMode = { kind: "resistance", range: DEFAULT_RANGE };

describe("FTMS encoding", () => {
  it("reads whether the slope or the resistance can be set", () => {
    // Elite Suito: target settings 0x0000200C (resistance, power, simulation).
    expect(controlFeatures(view(0, 0, 0, 0, 0x0c, 0x20, 0, 0))).toEqual({
      simulation: true,
      resistance: true,
    });
    expect(controlFeatures(view(0, 0, 0, 0, 0x04, 0, 0, 0))).toEqual({
      simulation: false,
      resistance: true,
    });
    expect(controlFeatures(view(0, 0, 0, 0, 0x08, 0, 0, 0))).toEqual({
      simulation: false,
      resistance: false,
    });
    expect(controlFeatures(view(0, 0))).toEqual({ simulation: false, resistance: false });
  });

  it("reads the supported resistance range", () => {
    expect(parseResistanceRange(view(0, 0, 200, 0, 1, 0))).toEqual(DEFAULT_RANGE);
    expect(parseResistanceRange(view(0, 0, 0, 0, 1, 0))).toBeNull();
    expect(parseResistanceRange(view(0, 0))).toBeNull();
  });

  it("maps the slopes onto the Suito resistances tested with a child", () => {
    expect(resistanceLevel(0, DEFAULT_RANGE)).toBe(0);
    expect(resistanceLevel(2, DEFAULT_RANGE)).toBe(10);
    expect(resistanceLevel(5, DEFAULT_RANGE)).toBe(25);
    expect(resistanceLevel(10, DEFAULT_RANGE)).toBe(50);
  });

  it("follows other ranges, their step, and stays a byte", () => {
    expect(resistanceLevel(5, { min: 10, max: 90, increment: 4 })).toBe(22);
    expect(resistanceLevel(5, { min: 0, max: 4000, increment: 1 })).toBe(255);
    expect(resistanceLevel(-3, DEFAULT_RANGE)).toBe(0);
    expect(resistanceLevel(80, DEFAULT_RANGE)).toBe(200);
  });

  it("encodes a simulated grade with the game's rolling and wind coefficients", () => {
    // Grade 5 % = 500 (0.01 %), Crr 0.004 = 40, wind coefficient 0.20 kg/m = 20.
    expect([...encodeSetSimulation(5)]).toEqual([OP_SET_SIMULATION, 0, 0, 0xf4, 0x01, 40, 19]);
    expect([...encodeSetSimulation(-1.5)]).toEqual([OP_SET_SIMULATION, 0, 0, 0x6a, 0xff, 40, 19]);
  });

  it("encodes the command and decodes the answer", () => {
    expect([...encodeSetResistance(25)]).toEqual([OP_SET_RESISTANCE, 25]);
    expect(parseControlResponse(view(0x80, 0x04, 0x01))).toEqual({
      opCode: OP_SET_RESISTANCE,
      result: RESULT_SUCCESS,
    });
    expect(parseControlResponse(view(0x12, 0x04, 0x01))).toBeNull();
  });
});

/** A trainer's control point answering each op code as told. */
function fakeControlPoint(answers: Partial<Record<number, number | "silent">> = {}) {
  let listener: (() => void) | null = null;
  const written: number[][] = [];
  const point: ControlPoint & { value?: DataView } = {
    writeValueWithResponse: vi.fn((value: BufferSource) => {
      const bytes = [...new Uint8Array(value as ArrayBuffer)];
      written.push(bytes);
      const opCode = bytes[0] ?? -1;
      const answer = answers[opCode] ?? RESULT_SUCCESS;
      if (answer !== "silent") {
        setTimeout(() => {
          point.value = view(0x80, opCode, answer);
          listener?.();
        }, 5);
      }
      return Promise.resolve();
    }),
    addEventListener: (_type, fn) => {
      listener = fn;
    },
  };
  return { point, written };
}

describe("FtmsControl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes control once, then sets the grade on a simulation trainer", async () => {
    const { point, written } = fakeControlPoint();
    const control = new FtmsControl(point, { kind: "simulation" });
    expect(await control.setSlope(5)).toBe(true);
    expect(written).toEqual([[OP_REQUEST_CONTROL], [OP_START], [...encodeSetSimulation(5)]]);
  });

  it("resends the current slope at once on a shift, in the new gear", async () => {
    const { point, written } = fakeControlPoint();
    const road = { rolling: 0.004, airDrag: 0.2 };
    const control = new FtmsControl(point, { kind: "simulation", road });
    await control.setSlope(4);
    expect(await control.setGear(1.5)).toBe(true);
    expect(written.at(-1)).toEqual([...encodeSetSimulation(4, road, 1.5)]);
    // Grade × 1.5 = 6 %, Crr × 1.5 = 0.006, Cw × 1.5³ = 0.675.
    expect(written.at(-1)).toEqual([OP_SET_SIMULATION, 0, 0, 0x58, 0x02, 60, 68]);
    await control.setSlope(2);
    expect(written.at(-1)).toEqual([...encodeSetSimulation(2, road, 1.5)]);
  });

  it("makes a resistance-only trainer harder in a bigger gear, even on the flat", async () => {
    const { point, written } = fakeControlPoint();
    const control = new FtmsControl(point, RESISTANCE);
    await control.setSlope(0);
    await control.setGear(2);
    expect(written.at(-2)).toEqual([OP_SET_RESISTANCE, 0]);
    expect((written.at(-1) ?? [])[1]).toBeGreaterThan(0);
  });

  it("sets a resistance level on a trainer without simulation", async () => {
    const { point, written } = fakeControlPoint();
    const control = new FtmsControl(point, RESISTANCE);
    expect(await control.setSlope(5)).toBe(true);
    expect(await control.setSlope(0)).toBe(true);
    expect(written).toEqual([
      [OP_REQUEST_CONTROL],
      [OP_START],
      [OP_SET_RESISTANCE, 25],
      [OP_SET_RESISTANCE, 0],
    ]);
  });

  it("still works when the trainer refuses the start command", async () => {
    const { point } = fakeControlPoint({ [OP_START]: 0x02 });
    expect(await new FtmsControl(point, RESISTANCE).setSlope(2)).toBe(true);
  });

  it("gives up when control is refused", async () => {
    const { point, written } = fakeControlPoint({
      [OP_REQUEST_CONTROL]: RESULT_CONTROL_NOT_PERMITTED,
    });
    expect(await new FtmsControl(point, RESISTANCE).setSlope(2)).toBe(false);
    expect(written).toEqual([[OP_REQUEST_CONTROL]]);
  });

  it("takes control back when another app took it meanwhile", async () => {
    const answers: Partial<Record<number, number>> = {};
    const { point, written } = fakeControlPoint(answers);
    const control = new FtmsControl(point, RESISTANCE);
    await control.setSlope(2);
    answers[OP_SET_RESISTANCE] = RESULT_CONTROL_NOT_PERMITTED;
    const retried = control.setSlope(5);
    // After the control request succeeds again, the resistance is accepted.
    setTimeout(() => {
      answers[OP_SET_RESISTANCE] = RESULT_SUCCESS;
    }, 7);
    expect(await retried).toBe(true);
    expect(written.slice(3)).toEqual([
      [OP_SET_RESISTANCE, 25],
      [OP_REQUEST_CONTROL],
      [OP_START],
      [OP_SET_RESISTANCE, 25],
    ]);
  });

  it("does not hang when the trainer never answers", async () => {
    vi.useFakeTimers();
    const { point } = fakeControlPoint({ [OP_REQUEST_CONTROL]: "silent" });
    const result = new FtmsControl(point, RESISTANCE).setSlope(2);
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS + 1);
    expect(await result).toBe(false);
  });

  it("never rejects, even if the write fails", async () => {
    const { point } = fakeControlPoint();
    point.writeValueWithResponse = vi.fn(() => Promise.reject(new Error("GATT error")));
    expect(await new FtmsControl(point, RESISTANCE).setSlope(2)).toBe(false);
  });

  it("sends one command at a time", async () => {
    const { point, written } = fakeControlPoint();
    const control = new FtmsControl(point, RESISTANCE);
    const both = await Promise.all([control.setSlope(5), control.setSlope(0)]);
    expect(both).toEqual([true, true]);
    expect(written.at(-2)).toEqual([OP_SET_RESISTANCE, 25]);
    expect(written.at(-1)).toEqual([OP_SET_RESISTANCE, 0]);
  });
});

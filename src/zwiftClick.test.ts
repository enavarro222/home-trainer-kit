import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerCharacteristic, ZwiftButton } from "./zwiftClick";
import {
  ASYNC_UUID,
  KEEPALIVE_MS,
  RIDE_ON,
  SYNC_RX_UUID,
  SYNC_TX_UUID,
  decodeButtons,
  newlyPressed,
  startController,
} from "./zwiftClick";

/** A protobuf varint. */
function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

/** Click v2 / Ride keypad status: field 1 is the bitmap, 0 bits pressed. */
const keypad = (pressedBits: number) =>
  new Uint8Array([0x23, 0x08, ...varint(0xffffffff - pressedBits)]);

describe("decodeButtons", () => {
  it("reads Click v2 and Ride keypad bitmaps, a pressed button being a 0 bit", () => {
    expect(decodeButtons(keypad(0))).toEqual(new Set());
    expect(decodeButtons(keypad(0x1000))).toEqual(new Set(["plus"]));
    expect(decodeButtons(keypad(0x100 | 0x1))).toEqual(new Set(["minus", "left"]));
    expect(decodeButtons(keypad(0x10 | 0x4))).toEqual(new Set(["a", "right"]));
  });

  it("reads the first Click's plus and minus fields", () => {
    expect(decodeButtons(new Uint8Array([0x37, 0x08, 0x00, 0x10, 0x01]))).toEqual(
      new Set(["plus"]),
    );
    expect(decodeButtons(new Uint8Array([0x37, 0x08, 0x01, 0x10, 0x00]))).toEqual(
      new Set(["minus"]),
    );
  });

  it("ignores other messages: idle pings, battery…", () => {
    expect(decodeButtons(new Uint8Array([0x19, 0x10, 0x64]))).toBeNull();
    expect(decodeButtons(new Uint8Array([0x15]))).toBeNull();
  });

  it("counts a held button once", () => {
    const held = new Set<ZwiftButton>(["plus"]);
    expect(newlyPressed(held, new Set(["plus"]))).toEqual([]);
    expect(newlyPressed(held, new Set(["plus", "minus"]))).toEqual(["minus"]);
  });
});

/** A fake characteristic: records writes, can push a value. */
function fake(uuid: string, properties: Partial<ControllerCharacteristic["properties"]>) {
  const listeners: (() => void)[] = [];
  const record = (v: BufferSource) => {
    c.written.push([...new Uint8Array(v as ArrayBuffer)]);
    return Promise.resolve();
  };
  const c = {
    uuid,
    properties: {
      notify: false,
      indicate: false,
      write: false,
      writeWithoutResponse: false,
      ...properties,
    },
    value: undefined as DataView | undefined,
    written: [] as number[][],
    startNotifications: vi.fn(() => Promise.resolve()),
    writeValueWithResponse: vi.fn(record),
    writeValueWithoutResponse: vi.fn(record),
    addEventListener: (_: string, l: () => void) => listeners.push(l),
    push(bytes: Uint8Array) {
      c.value = new DataView(bytes.buffer);
      for (const l of listeners) l();
    },
  };
  return c;
}

describe("startController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says RideOn, keeps saying it, and reports each press once", async () => {
    vi.useFakeTimers();
    const notify = fake(ASYNC_UUID, { notify: true });
    const indicate = fake(SYNC_TX_UUID, { indicate: true });
    const write = fake(SYNC_RX_UUID, { write: true });
    const presses: ZwiftButton[] = [];
    const stop = await startController([notify, indicate, write], (b) => presses.push(b));
    expect(notify.startNotifications).toHaveBeenCalled();
    expect(indicate.startNotifications).toHaveBeenCalled();
    expect(write.written).toEqual([[...RIDE_ON]]);

    notify.push(keypad(0x1000));
    notify.push(keypad(0x1000));
    notify.push(keypad(0));
    notify.push(keypad(0x100));
    expect(presses).toEqual(["plus", "minus"]);

    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(write.written).toHaveLength(3);
    stop();
    vi.advanceTimersByTime(KEEPALIVE_MS * 2);
    expect(write.written).toHaveLength(3);
  });

  it("on a Click v2, writes RideOn without response to 0003, not to the other writable ones", async () => {
    const extra = fake("00000100-19ca-4651-86e5-fa29dcdd09d1", {
      write: true,
      writeWithoutResponse: true,
      notify: true,
    });
    const notify = fake(ASYNC_UUID, { notify: true });
    const write = fake(SYNC_RX_UUID.toUpperCase(), { writeWithoutResponse: true });
    const indicate = fake(SYNC_TX_UUID, { indicate: true });
    const stop = await startController([extra, notify, write, indicate], () => undefined);
    expect(write.writeValueWithoutResponse).toHaveBeenCalled();
    expect(write.written).toEqual([[...RIDE_ON]]);
    expect(extra.written).toEqual([]);
    expect(extra.startNotifications).not.toHaveBeenCalled();
    stop();
  });

  it("refuses a device without the controller's characteristics", async () => {
    await expect(
      startController([fake(ASYNC_UUID, { notify: true })], () => undefined),
    ).rejects.toThrow();
  });
});

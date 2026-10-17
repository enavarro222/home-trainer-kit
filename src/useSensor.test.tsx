import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSensor } from "./useSensor";

/** A fake trainer speaking FTMS, the same object on every pick (as Chrome does). */
function fakeTrainer() {
  const listeners = new Map<string, () => void>();
  const gatt = {
    connected: false,
    connect: vi.fn(() => {
      gatt.connected = true;
      return Promise.resolve(server);
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
      listeners.get("gattserverdisconnected")?.();
    }),
  };
  const characteristic = {
    value: undefined,
    startNotifications: () => Promise.resolve(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const server = {
    getPrimaryService: () => Promise.resolve({ getCharacteristic: () => characteristic }),
  };
  const device = {
    name: "KICKR",
    gatt,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const requestDevice = vi.fn(() => Promise.resolve(device));
  Object.defineProperty(navigator, "bluetooth", { value: { requestDevice }, configurable: true });
  return { gatt, requestDevice, drop: () => listeners.get("gattserverdisconnected")?.() };
}

describe("useSensor", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "bluetooth");
  });

  it("connects a trainer", async () => {
    fakeTrainer();
    const { result } = renderHook(() => useSensor());
    await act(() => result.current.connect());
    expect(result.current.ready).toBe(true);
    expect(result.current.connection).toMatchObject({ kind: "bluetooth", deviceName: "KICKR" });
  });

  it("keeps the link when the same trainer is picked again", async () => {
    const trainer = fakeTrainer();
    const { result } = renderHook(() => useSensor());
    await act(() => result.current.connect());
    await act(() => result.current.connect());
    expect(trainer.gatt.disconnect).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(true);
  });

  it("reconnects a lost trainer without opening the picker again", async () => {
    const trainer = fakeTrainer();
    const { result } = renderHook(() => useSensor());
    await act(() => result.current.connect());
    act(() => {
      trainer.drop();
    });
    expect(result.current.ready).toBe(false);
    expect(result.current.connection).toMatchObject({ lost: true });

    await act(() => result.current.reconnect());
    expect(trainer.requestDevice).toHaveBeenCalledTimes(1);
    expect(trainer.gatt.connect).toHaveBeenCalledTimes(2);
    expect(result.current.ready).toBe(true);
  });

  it("leaves demo mode before opening the picker", async () => {
    const trainer = fakeTrainer();
    const { result } = renderHook(() => useSensor());
    act(() => {
      result.current.startDemo();
    });
    trainer.requestDevice.mockRejectedValueOnce(new DOMException("cancelled", "NotFoundError"));
    await act(() => result.current.connect());
    expect(result.current.error?.code).toBe("cancelled");
    expect(result.current.connection.kind).toBe("none");
    expect(result.current.ready).toBe(false);
  });

  it("keeps a connected trainer when picking another one is cancelled", async () => {
    const trainer = fakeTrainer();
    const { result } = renderHook(() => useSensor());
    await act(() => result.current.connect());
    trainer.requestDevice.mockRejectedValueOnce(new DOMException("cancelled", "NotFoundError"));
    await act(() => result.current.connect());
    expect(result.current.error?.code).toBe("cancelled");
    expect(result.current.connection).toMatchObject({ kind: "bluetooth", lost: false });
    expect(result.current.ready).toBe(true);
  });

  it("stays lost, with the reason, when reconnecting fails", async () => {
    const trainer = fakeTrainer();
    const { result } = renderHook(() => useSensor());
    await act(() => result.current.connect());
    act(() => {
      trainer.drop();
    });
    trainer.gatt.connect.mockRejectedValueOnce(new Error("out of range"));
    await act(() => result.current.reconnect());
    expect(result.current.connection).toMatchObject({ lost: true });
    expect(result.current.error?.code).toBe("failed");
    expect(result.current.ready).toBe(false);
  });
});

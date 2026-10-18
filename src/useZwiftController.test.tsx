import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useControls } from "./controls";
import { RELAY_MS, RETRY_DELAYS_MS, useZwiftController } from "./useZwiftController";
import type { ZwiftButton } from "./zwiftClick";
import { connectZwiftController, requestZwiftController } from "./zwiftClick";

vi.mock("./zwiftClick", () => ({
  isZwiftControllerSupported: () => true,
  requestZwiftController: vi.fn(),
  connectZwiftController: vi.fn(),
}));

const left = { id: "left", name: "Zwift Click" } as BluetoothDevice;
const right = { id: "right", name: "Zwift Click" } as BluetoothDevice;
const request = vi.mocked(requestZwiftController);
const open = vi.mocked(connectZwiftController);

/** Each device's latest link: drop it, or press its buttons. */
let links: Map<string, { drop: () => void; press: (b: ZwiftButton) => void }>;
let down: Set<string>;

beforeEach(() => {
  links = new Map();
  down = new Set();
  open.mockImplementation((device, onPress, onLost) => {
    if (down.has(device.id)) return Promise.reject(new Error("out of range"));
    links.set(device.id, { drop: onLost, press: onPress });
    return Promise.resolve({ name: device.name ?? "Zwift", disconnect: vi.fn() });
  });
});

const drop = (id: string) => {
  act(() => {
    links.get(id)?.drop();
  });
};

/** Lets the timer of retry `attempt` fire, and its connection settle. */
const wait = (attempt: number) =>
  act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[attempt] ?? 0));

const giveUp = async () => {
  for (const [attempt] of RETRY_DELAYS_MS.entries()) await wait(attempt);
};

describe("useZwiftController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    request.mockResolvedValue(left);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("connects a picked controller", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    expect(result.current).toMatchObject({ name: "Zwift Click", lost: false, error: null });
    expect(result.current.controllers).toHaveLength(1);
  });

  it("keeps both sides of a Click v2, picked one after the other", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    request.mockResolvedValue(right);
    await act(() => result.current.connect());
    expect(result.current.controllers.map((c) => c.id)).toEqual(["left", "right"]);
  });

  it("keeps one entry when the same controller is picked again", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    await act(() => result.current.connect());
    expect(result.current.controllers).toHaveLength(1);
  });

  it("shows each controller's last press, and emits its action", async () => {
    const gearUp = vi.fn();
    const { result } = renderHook(() => {
      useControls({ gearUp });
      return useZwiftController();
    });
    await act(() => result.current.connect());
    request.mockResolvedValue(right);
    await act(() => result.current.connect());
    act(() => {
      links.get("right")?.press("plus");
    });
    expect(result.current.controllers).toMatchObject([
      { id: "left", lastButton: null, presses: 0 },
      { id: "right", lastButton: "plus", presses: 1 },
    ]);
    expect(gearUp).toHaveBeenCalledTimes(1);
  });

  it("counts once a press relayed by the other side, shown on both lines", async () => {
    const gearUp = vi.fn();
    const { result } = renderHook(() => {
      useControls({ gearUp });
      return useZwiftController();
    });
    await act(() => result.current.connect());
    request.mockResolvedValue(right);
    await act(() => result.current.connect());
    act(() => {
      links.get("right")?.press("plus");
      links.get("left")?.press("plus");
    });
    expect(gearUp).toHaveBeenCalledTimes(1);
    expect(result.current.controllers.map((c) => c.lastButton)).toEqual(["plus", "plus"]);
    await act(() => vi.advanceTimersByTimeAsync(RELAY_MS));
    act(() => {
      links.get("left")?.press("plus");
    });
    expect(gearUp).toHaveBeenCalledTimes(2);
  });

  it("keeps a working link when its controller is picked again", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    await act(() => result.current.connect());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("comes back on its own after a short drop", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    drop("left");
    expect(result.current.lost).toBe(true);
    await wait(0);
    expect(result.current.lost).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("tries each delay, then gives up until asked", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    down.add("left");
    drop("left");
    await giveUp();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(open).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
    expect(result.current.lost).toBe(true);
  });

  it("reconnects only the lost side, without the browser list", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    request.mockResolvedValue(right);
    await act(() => result.current.connect());
    down.add("left");
    drop("left");
    await giveUp();
    expect(result.current.controllers.map((c) => c.lost)).toEqual([true, false]);
    down.clear();
    open.mockClear();
    await act(() => result.current.reconnect());
    expect(result.current.lost).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenLastCalledWith(left, expect.any(Function), expect.any(Function));
  });

  it("opens the browser list when no controller was picked yet", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.reconnect());
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.name).toBe("Zwift Click");
  });

  it("does not keep a new controller that fails to connect", async () => {
    down.add("left");
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    expect(result.current.controllers).toEqual([]);
    expect(result.current.error).toBe("out of range");
  });

  it("stops retrying once disconnected on purpose", async () => {
    const { result } = renderHook(() => useZwiftController());
    await act(() => result.current.connect());
    drop("left");
    act(() => {
      result.current.disconnect();
    });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(open).toHaveBeenCalledTimes(1);
    expect(result.current.controllers).toEqual([]);
  });
});

import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlAction } from "./controls";
import { emitControl } from "./controls";
import type { ZwiftButton, ZwiftController } from "./zwiftClick";
import {
  ZWIFT_DEVICE_TYPES,
  connectZwiftController,
  isZwiftControllerSupported,
  requestZwiftController,
} from "./zwiftClick";

/** What each button does: + and − shift, the arrows choose, A confirms; B, Y, Z are the game's. */
export const ZWIFT_ACTIONS: Readonly<Partial<Record<ZwiftButton, ControlAction>>> = {
  plus: "gearUp",
  minus: "gearDown",
  left: "left",
  right: "right",
  a: "select",
  up: "powerUp",
  down: "powerDown",
  b: "b",
  y: "y",
  z: "z",
};

/**
 * After a lost link, the controller is tried again on its own every RETRY_MS,
 * for as long as it stays picked. A Click v2 sleeps after a minute without a
 * press and drops the link: the next press wakes it, and the next attempt
 * brings it back (docs/zwift-click-v2.md).
 */
export const RETRY_MS = 2000;

/**
 * The controllers that work on their own: the right side of a pair (the
 * left one of a Click v2 answers only when unlocked) and the single Click.
 * For `connect`, to list only them in the browser picker.
 */
export const ZWIFT_PRIMARY_TYPES: readonly number[] = [
  ZWIFT_DEVICE_TYPES.click,
  ZWIFT_DEVICE_TYPES.clickV2Right,
  ZWIFT_DEVICE_TYPES.playRight,
  ZWIFT_DEVICE_TYPES.rideRight,
];

/** The other side of a pair, which may add buttons (the − of a Click v2). */
export const ZWIFT_SECONDARY_TYPES: readonly number[] = [
  ZWIFT_DEVICE_TYPES.clickV2Left,
  ZWIFT_DEVICE_TYPES.playLeft,
  ZWIFT_DEVICE_TYPES.rideLeft,
];

/**
 * The same button from another controller this soon after (ms) is the same
 * press: one side of a pair may relay the other's buttons.
 */
export const RELAY_MS = 250;

/** One connected controller: a Click v2 or a Zwift Play is two of them, left and right. */
export interface ZwiftControllerInfo {
  /** The browser's id for the device. */
  id: string;
  name: string;
  /** The link dropped (asleep, off, out of reach): tried again every RETRY_MS. */
  lost: boolean;
  /** Its last button pressed, to check it works; null before any. */
  lastButton: ZwiftButton | null;
  /** Presses so far: changes on each press, even of the same button. */
  presses: number;
}

export interface ZwiftControllerState {
  supported: boolean;
  connecting: boolean;
  /** Every controller picked, in the order picked. */
  controllers: readonly ZwiftControllerInfo[];
  /** The first controller's name, or null when none. */
  name: string | null;
  /** Some controller's link dropped. */
  lost: boolean;
  error: string | null;
  /**
   * Picks a controller in the browser list (needs a user gesture) and adds
   * it to the others: both sides of a pair are picked one after the other.
   * With `deviceTypes` (see ZWIFT_DEVICE_TYPES), only those are listed.
   */
  connect: (deviceTypes?: readonly number[]) => Promise<void>;
  /** Every lost controller, again, without the browser list; with none picked, `connect`. */
  reconnect: () => Promise<void>;
  /** Disconnects them all. */
  disconnect: () => void;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Link {
  device: BluetoothDevice;
  controller: ZwiftController | null;
  retry: ReturnType<typeof setTimeout> | null;
  /** The attempt under way: a manual reconnection joins it rather than racing it. */
  opening: Promise<void> | null;
  /** Stops watching the device's advertisements, if watching. */
  unwatch: (() => void) | null;
}

/**
 * While lost, watches the device's advertisements where Chrome allows it
 * (behind a flag for now): it makes Chrome scan, which lets a reconnection
 * find a woken controller (measured on Linux).
 */
function watch(device: BluetoothDevice): (() => void) | null {
  if (!("watchAdvertisements" in device)) return null;
  const abort = new AbortController();
  device.watchAdvertisements({ signal: abort.signal }).catch(() => undefined);
  return () => {
    abort.abort();
  };
}

/** Zwift Click / Ride / Play controllers, their presses emitted as handlebar actions (see controls). */
export function useZwiftController(): ZwiftControllerState {
  const [connecting, setConnecting] = useState(false);
  const [controllers, setControllers] = useState<readonly ZwiftControllerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const links = useRef(new Map<string, Link>());
  /** Each button's last press emitted: which controller, and when. */
  const emitted = useRef(new Map<ZwiftButton, { id: string; at: number }>());

  const update = useCallback((id: string, change: Partial<ZwiftControllerInfo>) => {
    setControllers((all) => all.map((c) => (c.id === id ? { ...c, ...change } : c)));
  }, []);

  const stopRetrying = (link: Link) => {
    if (link.retry !== null) clearTimeout(link.retry);
    link.retry = null;
    link.unwatch?.();
    link.unwatch = null;
  };

  /** Connects to `device`; on a lost link, retries it every RETRY_MS until back or dropped. */
  const attach = useCallback(
    async (device: BluetoothDevice) => {
      const id = device.id;
      const known = links.current.get(id);
      // Picked again while connected: it already works, a new link would
      // only cut this one.
      if (known?.controller) return;
      if (known?.opening) return known.opening;
      const link: Link = known ?? {
        device,
        controller: null,
        retry: null,
        opening: null,
        unwatch: null,
      };
      if (link.retry !== null) clearTimeout(link.retry);
      link.retry = null;
      links.current.set(id, link);
      const current = () => links.current.get(id) === link;

      const retryLater = () => {
        if (!current() || link.retry !== null) return;
        link.unwatch ??= watch(device);
        link.retry = setTimeout(() => {
          link.retry = null;
          if (!current() || link.controller || link.opening) return;
          once().catch(retryLater);
        }, RETRY_MS);
      };
      const onPress = (button: ZwiftButton) => {
        const at = performance.now();
        const last = emitted.current.get(button);
        const relayed = last !== undefined && last.id !== id && at - last.at < RELAY_MS;
        if (!relayed) {
          emitted.current.set(button, { id, at });
          const action = ZWIFT_ACTIONS[button];
          if (action) emitControl(action);
        }
        // Shown on its line all the same: it tells which side reports what.
        setControllers((all) =>
          all.map((c) => (c.id === id ? { ...c, lastButton: button, presses: c.presses + 1 } : c)),
        );
      };
      const open = async () => {
        const controller = await connectZwiftController(device, onPress, () => {
          if (link.controller === controller) link.controller = null;
          update(id, { lost: true });
          retryLater();
        });
        if (!current()) {
          // Dropped while connecting.
          controller.disconnect();
          return;
        }
        stopRetrying(link);
        link.controller = controller;
        setControllers((all) =>
          all.some((c) => c.id === id)
            ? all.map((c) => (c.id === id ? { ...c, name: controller.name, lost: false } : c))
            : [...all, { id, name: controller.name, lost: false, lastButton: null, presses: 0 }],
        );
        setError(null);
      };
      /** One attempt at a time, shared by whoever asks meanwhile. */
      const once = () => {
        link.opening ??= open().finally(() => {
          link.opening = null;
        });
        return link.opening;
      };
      try {
        await once();
      } catch (e) {
        // A new pick that fails is not kept; a known one stays, lost, and
        // is tried again.
        if (known) retryLater();
        else links.current.delete(id);
        throw e;
      }
    },
    [update],
  );

  const run = useCallback(async (connectAll: () => Promise<void>) => {
    setConnecting(true);
    setError(null);
    try {
      await connectAll();
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "NotFoundError";
      setError(cancelled ? null : messageOf(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const connect = useCallback(
    (deviceTypes?: readonly number[]) =>
      run(async () => attach(await requestZwiftController(deviceTypes))),
    [run, attach],
  );

  const reconnect = useCallback(() => {
    const lost = [...links.current.values()].filter((l) => l.controller === null);
    if (links.current.size === 0) return connect();
    return run(async () => {
      const results = await Promise.allSettled(lost.map((l) => attach(l.device)));
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
    });
  }, [run, attach, connect]);

  const disconnect = useCallback(() => {
    for (const link of links.current.values()) {
      stopRetrying(link);
      link.controller?.disconnect();
    }
    links.current.clear();
    setControllers([]);
  }, []);

  useEffect(
    () => () => {
      for (const link of links.current.values()) {
        stopRetrying(link);
        link.controller?.disconnect();
      }
      links.current.clear();
    },
    [],
  );

  return {
    supported: isZwiftControllerSupported(),
    connecting,
    controllers,
    name: controllers[0]?.name ?? null,
    lost: controllers.some((c) => c.lost),
    error,
    connect,
    reconnect,
    disconnect,
  };
}

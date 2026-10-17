import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlAction } from "./controls";
import { emitControl } from "./controls";
import type { ZwiftButton, ZwiftController } from "./zwiftClick";
import {
  connectZwiftController,
  isZwiftControllerSupported,
  requestZwiftController,
} from "./zwiftClick";

/** What each button does: + and − shift, the arrows choose, A confirms. */
export const ZWIFT_ACTIONS: Readonly<Partial<Record<ZwiftButton, ControlAction>>> = {
  plus: "gearUp",
  minus: "gearDown",
  left: "left",
  right: "right",
  a: "select",
  up: "powerUp",
  down: "powerDown",
};

export interface ZwiftControllerState {
  supported: boolean;
  connecting: boolean;
  /** The connected controller's name, or null. */
  name: string | null;
  /** The link dropped; reconnect from a gesture. */
  lost: boolean;
  error: string | null;
  /** Picks a controller in the browser list (needs a user gesture). */
  connect: () => Promise<void>;
  disconnect: () => void;
}

/** A Zwift Click / Ride, its presses emitted as handlebar actions (see controls). */
export function useZwiftController(): ZwiftControllerState {
  const [connecting, setConnecting] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ZwiftController | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const device = await requestZwiftController();
      const controller = await connectZwiftController(
        device,
        (button) => {
          const action = ZWIFT_ACTIONS[button];
          if (action) emitControl(action);
        },
        () => {
          setLost(true);
        },
      );
      current.current?.disconnect();
      current.current = controller;
      setName(controller.name);
      setLost(false);
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === "NotFoundError";
      setError(cancelled ? null : e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    current.current?.disconnect();
    current.current = null;
    setName(null);
    setLost(false);
  }, []);

  useEffect(
    () => () => {
      current.current?.disconnect();
    },
    [],
  );

  return {
    supported: isZwiftControllerSupported(),
    connecting,
    name,
    lost,
    error,
    connect,
    disconnect,
  };
}

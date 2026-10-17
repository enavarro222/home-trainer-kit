import { useEffect, useRef } from "react";

/**
 * What a rider can do from the handlebar, whatever the device: gamepad,
 * Zwift controller… Sources emit actions; screens listen with useControls.
 * The keyboard stays each game's own business.
 */
export type ControlAction =
  | "left"
  | "right"
  /** Confirm: pause in a ride, next on a results screen. */
  | "select"
  | "gearUp"
  | "gearDown"
  | "powerUp"
  | "powerDown"
  /** Buttons with no meaning of their own (Zwift B, Y, Z): the game chooses. */
  | "b"
  | "y"
  | "z";

type Listener = (action: ControlAction) => void;
const listeners = new Set<Listener>();

export function emitControl(action: ControlAction): void {
  for (const l of [...listeners]) l(action);
}

/** Subscribes a screen to handlebar actions while it is mounted. */
export function useControls(handlers: Partial<Record<ControlAction, () => void>>): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const listener: Listener = (action) => {
      ref.current[action]?.();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

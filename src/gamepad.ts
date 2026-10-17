import { useEffect } from "react";
import type { ControlAction } from "./controls";
import { emitControl } from "./controls";

/** Standard mapping (https://w3c.github.io/gamepad/#remapping). */
const BUTTONS: Record<number, ControlAction> = {
  14: "left", // d-pad
  15: "right",
  4: "gearDown", // shoulder buttons: under the thumbs on the handlebar
  5: "gearUp",
  0: "select", // A
  9: "select", // Start
  3: "powerUp", // Y
  2: "powerDown", // X
};
const STICK = 0.6;

/** The actions held on a pad: buttons, and the left stick pushed sideways. */
export function pressed(pad: Pick<Gamepad, "buttons" | "axes">): Set<ControlAction> {
  const out = new Set<ControlAction>();
  pad.buttons.forEach((b, i) => {
    const action = BUTTONS[i];
    if (action && b.pressed) out.add(action);
  });
  const x = pad.axes[0] ?? 0;
  if (x < -STICK) out.add("left");
  if (x > STICK) out.add("right");
  return out;
}

/**
 * Gamepads (and handlebar remotes that show up as one), polled every frame
 * while mounted: each press emits its action once. Mount it once, app-wide.
 */
export function useGamepadControls(): void {
  useEffect(() => {
    if (typeof navigator.getGamepads !== "function") return;
    let before = new Set<ControlAction>();
    let id = requestAnimationFrame(function poll() {
      const now = new Set<ControlAction>();
      for (const pad of navigator.getGamepads()) {
        if (pad) for (const a of pressed(pad)) now.add(a);
      }
      for (const a of now) if (!before.has(a)) emitControl(a);
      before = now;
      id = requestAnimationFrame(poll);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, []);
}

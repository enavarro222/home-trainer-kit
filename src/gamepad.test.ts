import { describe, expect, it } from "vitest";
import { pressed } from "./gamepad";

const pad = (down: number[], x = 0) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) }) as GamepadButton),
  axes: [x, 0],
});

describe("pressed", () => {
  it("maps the d-pad to choices, shoulders to gears, A/Start to select, X/Y to power", () => {
    expect([...pressed(pad([14]))]).toEqual(["left"]);
    expect([...pressed(pad([5]))]).toEqual(["gearUp"]);
    expect([...pressed(pad([4]))]).toEqual(["gearDown"]);
    expect([...pressed(pad([9]))]).toEqual(["select"]);
    expect([...pressed(pad([3]))]).toEqual(["powerUp"]);
  });

  it("reads the stick only when pushed well over", () => {
    expect([...pressed(pad([], -0.3))]).toEqual([]);
    expect([...pressed(pad([], -0.9))]).toEqual(["left"]);
  });
});

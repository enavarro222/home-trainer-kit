import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emitControl, useControls } from "./controls";

function Screen({ onLeft }: { onLeft: () => void }) {
  useControls({ left: onLeft });
  return null;
}

describe("useControls", () => {
  it("hands actions to the mounted screens, and stops once unmounted", () => {
    const onLeft = vi.fn();
    const { unmount } = render(<Screen onLeft={onLeft} />);
    act(() => {
      emitControl("left");
      emitControl("right");
    });
    expect(onLeft).toHaveBeenCalledTimes(1);
    unmount();
    emitControl("left");
    expect(onLeft).toHaveBeenCalledTimes(1);
  });
});

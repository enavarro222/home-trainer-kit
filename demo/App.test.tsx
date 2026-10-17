import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitControl } from "../src";
import { App } from "./App";

describe("the test app", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says when the browser has no Bluetooth", () => {
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent("pas de Bluetooth");
  });

  it("shows the live reading of the demo sensor", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Essayer sans matériel" }));
    expect(screen.getByText(/pédale avec ← et →/)).toBeInTheDocument();
    expect(screen.getByText("Puissance")).toBeInTheDocument();
  });

  it("logs each handlebar action it receives", () => {
    render(<App />);
    act(() => {
      emitControl("gearUp");
      emitControl("left");
    });
    expect(screen.getByText(/vitesse \+/)).toBeInTheDocument();
    expect(screen.getByText(/← gauche/)).toBeInTheDocument();
  });
});

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BluetoothError,
  type BluetoothErrorCode,
  type BluetoothSensor,
  connectTrainer,
  type Protocol,
  requestTrainer,
} from "./ble/bluetoothSensor";
import { DemoSensor } from "./demo/demoSensor";
import type { Road } from "./gears";
import type { Sensor } from "./types";

export type Connection =
  | { kind: "none" }
  | { kind: "demo" }
  | {
      kind: "bluetooth";
      deviceName: string;
      protocol: Protocol;
      /** The game sets the trainer's slope. */
      controllable: boolean;
      slopeControl: "simulation" | "resistance" | null;
      lost: boolean;
    };

export interface ConnectionError {
  code: Exclude<BluetoothErrorCode, "unsupported">;
  message: string;
}

export interface SensorState {
  sensor: Sensor | null;
  connection: Connection;
  connecting: boolean;
  error: ConnectionError | null;
  /** A sensor that can be ridden right now. */
  ready: boolean;
  /** Picks a trainer in the browser list (needs a user gesture). */
  connect: () => Promise<void>;
  /** Reconnects the last picked trainer, without the picker. */
  reconnect: () => Promise<void>;
  startDemo: () => void;
}

const isBluetooth = (sensor: Sensor | null): sensor is BluetoothSensor =>
  sensor?.kind === "bluetooth";

export function useSensor(
  /** The game's road model, for simulated slopes (see connectTrainer). */
  road?: Road,
): SensorState {
  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: "none" });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<ConnectionError | null>(null);
  const current = useRef<Sensor | null>(null);

  const replace = useCallback((next: Sensor, nextConnection: Connection) => {
    const previous = current.current;
    // Picking the same trainer again yields the same BluetoothDevice object:
    // disconnecting the old sensor would cut the brand-new link.
    if (isBluetooth(previous) && isBluetooth(next) && previous.device === next.device) {
      previous.detach();
    } else {
      previous?.disconnect();
    }
    current.current = next;
    setSensor(next);
    setConnection(nextConnection);
    setError(null);
  }, []);

  const attach = useCallback(
    async (getDevice: () => Promise<BluetoothDevice>) => {
      setConnecting(true);
      setError(null);
      try {
        const device = await getDevice();
        const result = await connectTrainer(
          device,
          () => {
            if (current.current?.kind !== "bluetooth") return;
            setConnection((c) => (c.kind === "bluetooth" ? { ...c, lost: true } : c));
          },
          road,
        );
        replace(result.sensor, {
          kind: "bluetooth",
          deviceName: result.deviceName,
          protocol: result.protocol,
          controllable: result.controllable,
          slopeControl: result.slopeControl,
          lost: false,
        });
      } catch (e) {
        // The previous sensor, if any, stays in place.
        const code = e instanceof BluetoothError && e.code !== "unsupported" ? e.code : "failed";
        setError({ code, message: e instanceof Error ? e.message : String(e) });
      } finally {
        setConnecting(false);
      }
    },
    [replace, road],
  );

  const connect = useCallback(() => {
    // Leave the demo first: cancelling the picker then means "no bike" rather
    // than a demo still running unnoticed. Stays synchronous so the picker
    // still opens from the user's gesture.
    if (current.current?.kind === "demo") {
      current.current.disconnect();
      current.current = null;
      setSensor(null);
      setConnection({ kind: "none" });
    }
    return attach(requestTrainer);
  }, [attach]);

  const reconnect = useCallback(() => {
    const previous = current.current;
    return attach(isBluetooth(previous) ? () => Promise.resolve(previous.device) : requestTrainer);
  }, [attach]);

  const startDemo = useCallback(() => {
    replace(new DemoSensor(), { kind: "demo" });
  }, [replace]);

  useEffect(
    () => () => {
      current.current?.disconnect();
    },
    [],
  );

  const ready =
    sensor !== null &&
    (connection.kind === "demo" || (connection.kind === "bluetooth" && !connection.lost));

  return {
    sensor,
    connection,
    connecting,
    error,
    ready,
    connect,
    reconnect,
    startDemo,
  };
}

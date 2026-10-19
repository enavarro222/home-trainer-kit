// Smart trainers (Bluetooth FTMS, Cycling Power, CSC)
export type { Sensor, SensorReading } from "./types";
export { ZERO_READING } from "./types";
export type {
  BluetoothConnection,
  BluetoothErrorCode,
  BluetoothSensor,
  Protocol,
} from "./ble/bluetoothSensor";
export {
  BluetoothError,
  connectTrainer,
  isBluetoothSupported,
  requestTrainer,
} from "./ble/bluetoothSensor";
export type { Foot } from "./demo/demoSensor";
export { DemoSensor, MAX_DEMO_CADENCE, STOP_AFTER_MS, cadenceFor } from "./demo/demoSensor";
export type { Connection, ConnectionError, SensorState } from "./useSensor";
export { useSensor } from "./useSensor";

// Virtual gears
export type { Drivetrain, Road } from "./gears";
export {
  DEFAULT_DRIVETRAIN,
  DEFAULT_ROAD,
  VIRTUAL_RATIOS,
  gearFactor,
  gearedSimulation,
  neutralGear,
  realRatio,
  shift,
} from "./gears";

// Handlebar controls: gamepad, Zwift Click / Ride
export type { ControlAction } from "./controls";
export { emitControl, useControls } from "./controls";
export { pressed, useGamepadControls } from "./gamepad";
export type { ControllerOptions, OnZwiftMessage, ZwiftButton, ZwiftController } from "./zwiftClick";
export {
  RIDE_ON,
  ZWIFT_DEVICE_TYPES,
  connectZwiftController,
  decodeButtons,
  isZwiftControllerSupported,
  requestZwiftController,
} from "./zwiftClick";
export type { ZwiftControllerInfo, ZwiftControllerState } from "./useZwiftController";
export {
  RETRY_MS,
  ZWIFT_ACTIONS,
  ZWIFT_PRIMARY_TYPES,
  ZWIFT_SECONDARY_TYPES,
  useZwiftController,
} from "./useZwiftController";

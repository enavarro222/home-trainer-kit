/**
 * Zwift's handlebar controllers (Click, Click v2, Ride) over Web Bluetooth.
 * Unofficial: Zwift doesn't publish the protocol, this follows reverse
 * engineering (makinolo.com, github.com/thomaschampagne/zwiftboard,
 * github.com/ajchellew/zwiftplay), and a firmware update may break it.
 *
 * Handshake: write "RideOn" to the write characteristic; the controller
 * answers "RideOn" on the indicate one, then sends its buttons on the notify
 * one. "RideOn" again every few seconds keeps the link up.
 */

export type ZwiftButton =
  "left" | "up" | "right" | "down" | "a" | "b" | "y" | "z" | "minus" | "plus";

/** Zwift's Bluetooth company identifier, in advertisements. */
export const ZWIFT_MANUFACTURER = 0x094a;
/**
 * The first byte of a controller's manufacturer data: which model and side.
 * From BikeControl (lib/bluetooth/devices/zwift/constants.dart); the Click
 * v2 values are marked unconfirmed there.
 */
export const ZWIFT_DEVICE_TYPES = {
  playRight: 0x02,
  playLeft: 0x03,
  rideRight: 0x07,
  rideLeft: 0x08,
  click: 0x09,
  clickV2Right: 0x0a,
  clickV2Left: 0x0b,
} as const;

/** The controllers' service; Ride controllers updated since January 2025 use FC82. */
export const ZWIFT_SERVICES: readonly BluetoothServiceUUID[] = [
  "00000001-19ca-4651-86e5-fa29dcdd09d1",
  0xfc82,
];
export const RIDE_ON = new TextEncoder().encode("RideOn");
/** The controller's own characteristics, the same under both services. */
const zwiftUuid = (n: number) => `0000000${n}-19ca-4651-86e5-fa29dcdd09d1`;
/** Buttons, notified. */
export const ASYNC_UUID = zwiftUuid(2);
/** RideOn and commands, written (without response on the Click v2). */
export const SYNC_RX_UUID = zwiftUuid(3);
/** Answers, indicated. */
export const SYNC_TX_UUID = zwiftUuid(4);
export const KEEPALIVE_MS = 3000;

/** Click v2 and Ride: a 32-bit field, a button pressed when its bit is 0. */
const KEYPAD_STATUS = 0x23;
/** The first Click: one field per button, 0 when pressed. */
const CLICK_STATUS = 0x37;

const BITS: readonly [ZwiftButton, number][] = [
  ["left", 0x1],
  ["up", 0x2],
  ["right", 0x4],
  ["down", 0x8],
  ["a", 0x10],
  ["b", 0x20],
  ["y", 0x40],
  ["z", 0x80],
  ["minus", 0x100],
  ["plus", 0x1000],
];

/** A protobuf varint at `at`: its value and where the next field starts. */
function varint(bytes: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = at, shift = 0; i < bytes.length && shift < 35; i++, shift += 7) {
    const b = bytes[i] ?? 0;
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return { value, next: i + 1 };
  }
  return null;
}

/** The varint fields of a protobuf message, by field number (others skipped). */
function varintFields(bytes: Uint8Array, from: number): Map<number, number> {
  const fields = new Map<number, number>();
  let at = from;
  while (at < bytes.length) {
    const key = varint(bytes, at);
    if (!key) break;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 7;
    if (wire === 0) {
      const v = varint(bytes, key.next);
      if (!v) break;
      fields.set(field, v.value);
      at = v.next;
    } else if (wire === 2) {
      const length = varint(bytes, key.next);
      if (!length) break;
      at = length.next + length.value;
    } else {
      break; // fixed-size fields: none expected in a button message
    }
  }
  return fields;
}

/** The buttons held down in a notification, or null when it isn't a button message. */
export function decodeButtons(bytes: Uint8Array): Set<ZwiftButton> | null {
  const id = bytes[0];
  if (id === KEYPAD_STATUS) {
    const bitmap = varintFields(bytes, 1).get(1);
    if (bitmap === undefined) return null;
    return new Set(BITS.filter(([, bit]) => (bitmap & bit) === 0).map(([b]) => b));
  }
  if (id === CLICK_STATUS) {
    const fields = varintFields(bytes, 1);
    const down = new Set<ZwiftButton>();
    if (fields.get(1) === 0) down.add("plus");
    if (fields.get(2) === 0) down.add("minus");
    return down;
  }
  return null;
}

/** Buttons pressed now that weren't before: each press counts once. */
export const newlyPressed = (
  before: ReadonlySet<ZwiftButton>,
  now: ReadonlySet<ZwiftButton>,
): ZwiftButton[] => [...now].filter((b) => !before.has(b));

export const isZwiftControllerSupported = (): boolean =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;

/**
 * Opens the browser device picker on Zwift controllers. Must run from a user
 * gesture. With `deviceType` (see ZWIFT_DEVICE_TYPES), only that model and
 * side are listed: the picker shows names only, the same for both sides.
 */
export function requestZwiftController(deviceType?: number): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters:
      deviceType === undefined
        ? [
            { manufacturerData: [{ companyIdentifier: ZWIFT_MANUFACTURER }] },
            { namePrefix: "Zwift" },
          ]
        : [
            {
              manufacturerData: [
                { companyIdentifier: ZWIFT_MANUFACTURER, dataPrefix: new Uint8Array([deviceType]) },
              ],
            },
          ],
    optionalServices: [...ZWIFT_SERVICES],
  });
}

/** Every message from a controller, raw: for diagnosing a model. */
export type OnZwiftMessage = (channel: "buttons" | "answers", bytes: Uint8Array) => void;

export interface ControllerOptions {
  onMessage?: OnZwiftMessage;
  /** Written at start and every KEEPALIVE_MS; RIDE_ON by default. */
  hello?: Uint8Array<ArrayBuffer>;
}

export interface ZwiftController {
  readonly name: string;
  disconnect(): void;
}

/** What the connection needs from a GATT characteristic; lets tests use a fake. */
export interface ControllerCharacteristic {
  readonly uuid: string;
  readonly properties: {
    notify: boolean;
    indicate: boolean;
    write: boolean;
    writeWithoutResponse: boolean;
  };
  readonly value?: DataView;
  startNotifications(): Promise<unknown>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: () => void): void;
  removeEventListener(type: "characteristicvaluechanged", listener: () => void): void;
}

/**
 * Handshake on a controller's characteristics (picked by UUID: the Click v2
 * also has write + notify ones, 0100 to 0102, that refuse RideOn), then
 * button presses until `stop` is called.
 */
export async function startController(
  characteristics: readonly ControllerCharacteristic[],
  onPress: (button: ZwiftButton) => void,
  { onMessage, hello = RIDE_ON }: ControllerOptions = {},
): Promise<() => void> {
  const byUuid = (uuid: string) => characteristics.find((c) => c.uuid.toLowerCase() === uuid);
  const notify = byUuid(ASYNC_UUID);
  const indicate = byUuid(SYNC_TX_UUID);
  const write = byUuid(SYNC_RX_UUID);
  if (!notify || !write) throw new Error("not a Zwift controller");
  const rideOn = () =>
    write.properties.write
      ? write.writeValueWithResponse(hello)
      : write.writeValueWithoutResponse(hello);
  let held = new Set<ZwiftButton>();
  const bytesOf = (v: DataView) =>
    new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  const onAnswer = () => {
    if (indicate?.value) onMessage?.("answers", bytesOf(indicate.value));
  };
  const onValue = () => {
    const v = notify.value;
    if (!v) return;
    onMessage?.("buttons", bytesOf(v));
    const now = decodeButtons(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (!now) return;
    for (const b of newlyPressed(held, now)) onPress(b);
    held = now;
  };
  // Chrome hands back the same characteristic on a new connection to the
  // same device: a listener left behind would report every press twice.
  notify.addEventListener("characteristicvaluechanged", onValue);
  if (onMessage) indicate?.addEventListener("characteristicvaluechanged", onAnswer);
  await notify.startNotifications();
  if (indicate) await indicate.startNotifications();
  await rideOn();
  const keepalive = setInterval(() => {
    rideOn().catch(() => undefined);
  }, KEEPALIVE_MS);
  return () => {
    clearInterval(keepalive);
    notify.removeEventListener("characteristicvaluechanged", onValue);
    indicate?.removeEventListener("characteristicvaluechanged", onAnswer);
  };
}

/** Connects to a picked controller; `onLost` when the link drops. */
export async function connectZwiftController(
  device: BluetoothDevice,
  onPress: (button: ZwiftButton) => void,
  onLost: () => void,
  options: ControllerOptions = {},
): Promise<ZwiftController> {
  const gatt = device.gatt;
  if (!gatt) throw new Error("no GATT server");
  const server = await gatt.connect();
  let service: BluetoothRemoteGATTService | null = null;
  for (const uuid of ZWIFT_SERVICES) {
    service = await server.getPrimaryService(uuid).catch(() => null);
    if (service) break;
  }
  if (!service) {
    gatt.disconnect();
    throw new Error("not a Zwift controller");
  }
  const stop = await startController(await service.getCharacteristics(), onPress, options);
  const lost = () => {
    stop();
    onLost();
  };
  device.addEventListener("gattserverdisconnected", lost);
  return {
    name: device.name ?? "Zwift",
    disconnect: () => {
      device.removeEventListener("gattserverdisconnected", lost);
      stop();
      gatt.disconnect();
    },
  };
}

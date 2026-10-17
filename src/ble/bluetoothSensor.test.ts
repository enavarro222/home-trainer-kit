import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BluetoothError,
  type BluetoothErrorCode,
  connectTrainer,
  requestTrainer,
} from "./bluetoothSensor";
import {
  encodeSetResistance,
  encodeSetSimulation,
  OP_REQUEST_CONTROL,
  OP_START,
  resistanceLevel,
} from "./ftmsControl";

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

const FTMS = 0x1826;
const CYCLING_POWER = 0x1818;
const CSC = 0x1816;
const INDOOR_BIKE_DATA = 0x2ad2;
const POWER_MEASUREMENT = 0x2a63;
const CSC_MEASUREMENT = 0x2a5b;
const FTMS_FEATURE = 0x2acc;
const RESISTANCE_RANGE = 0x2ad6;
const CONTROL_POINT = 0x2ad9;

/** FTMS Indoor Bike Data: 90 rpm, 150 W (speed present). */
const FTMS_90_RPM = view(...u16(0x0044), ...u16(2500), ...u16(180), ...u16(150));
/** Cycling Power Measurement: no flags, 200 W. */
const POWER_200_W = view(...u16(0), ...u16(200));
/** Fitness Machine Feature: resistance target supported (as an Elite Suito). */
const CAN_SET_RESISTANCE = view(0, 0, 0, 0, 0x04, 0, 0, 0);
/** Elite Suito: resistance, power and simulation. */
const CAN_SIMULATE = view(0, 0, 0, 0, 0x0c, 0x20, 0, 0);

/** A GATT characteristic: notifications, reads, and a trainer that obeys. */
class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  written: number[][] = [];
  constructor(private readonly readable?: DataView) {
    super();
  }
  startNotifications = vi.fn(() => Promise.resolve(this));
  readValue() {
    return this.readable ? Promise.resolve(this.readable) : Promise.reject(new Error("unreadable"));
  }
  notify(data: DataView) {
    this.value = data;
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
  /** Control point: answer every request with "success". */
  writeValueWithResponse(data: Uint8Array) {
    this.written.push([...data]);
    queueMicrotask(() => {
      this.notify(view(0x80, data[0] ?? 0, 0x01));
    });
    return Promise.resolve();
  }
}

type Services = Partial<Record<number, Partial<Record<number, FakeCharacteristic>>>>;

function fakeDevice(services: Services, name = "KICKR") {
  const disconnect = vi.fn();
  const connect = vi.fn(() => Promise.resolve(server));
  const server = {
    getPrimaryService: (uuid: number) => {
      const characteristics = services[uuid];
      if (!characteristics) return Promise.reject(new Error("service not found"));
      return Promise.resolve({
        getCharacteristic: (id: number) => {
          const characteristic = characteristics[id];
          return characteristic
            ? Promise.resolve(characteristic)
            : Promise.reject(new Error("characteristic not found"));
        },
      });
    },
  };
  const device = Object.assign(new EventTarget(), {
    name,
    gatt: { connect, disconnect },
  });
  return { device: device as unknown as BluetoothDevice, connect, disconnect };
}

async function failure(promise: Promise<unknown>): Promise<BluetoothErrorCode | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof BluetoothError) return error.code;
    throw error;
  }
}

describe("connectTrainer", () => {
  it("prefers FTMS, and reads the cadence it notifies", async () => {
    const data = new FakeCharacteristic();
    const power = new FakeCharacteristic();
    const { device } = fakeDevice({
      [FTMS]: { [INDOOR_BIKE_DATA]: data },
      [CYCLING_POWER]: { [POWER_MEASUREMENT]: power },
    });
    const connection = await connectTrainer(device, () => undefined);

    expect(connection).toMatchObject({ deviceName: "KICKR", protocol: "FTMS" });
    expect(power.startNotifications).not.toHaveBeenCalled();
    data.notify(FTMS_90_RPM);
    expect(connection.sensor.read(performance.now())).toEqual({ cadence: 90, power: 150 });
  });

  it("falls back to Cycling Power, then CSC, when the richer services are missing", async () => {
    const power = new FakeCharacteristic();
    const powerMeter = fakeDevice({ [CYCLING_POWER]: { [POWER_MEASUREMENT]: power } });
    const connection = await connectTrainer(powerMeter.device, () => undefined);
    expect(connection.protocol).toBe("Cycling Power");
    expect(connection.controllable).toBe(false);
    power.notify(POWER_200_W);
    expect(connection.sensor.read(performance.now()).power).toBe(200);

    const crank = fakeDevice({ [CSC]: { [CSC_MEASUREMENT]: new FakeCharacteristic() } });
    expect((await connectTrainer(crank.device, () => undefined)).protocol).toBe("CSC");
  });

  it("skips a service whose notifications cannot start", async () => {
    const broken = new FakeCharacteristic();
    broken.startNotifications.mockRejectedValue(new Error("GATT error"));
    const { device } = fakeDevice({
      [FTMS]: { [INDOOR_BIKE_DATA]: broken },
      [CSC]: { [CSC_MEASUREMENT]: new FakeCharacteristic() },
    });
    expect((await connectTrainer(device, () => undefined)).protocol).toBe("CSC");
  });

  it("gives up, and lets the device go, when nothing usable answers", async () => {
    const { device, disconnect } = fakeDevice({ 0x180f: {} }, "Heart rate belt");
    expect(await failure(connectTrainer(device, () => undefined))).toBe("noData");
    expect(disconnect).toHaveBeenCalled();
  });

  it("reports a refused connection", async () => {
    const { device, connect } = fakeDevice({});
    connect.mockRejectedValue(new Error("out of range"));
    expect(await failure(connectTrainer(device, () => undefined))).toBe("failed");
    const noGatt = Object.assign(new EventTarget(), { gatt: undefined });
    expect(await failure(connectTrainer(noGatt as unknown as BluetoothDevice, vi.fn()))).toBe(
      "failed",
    );
  });

  it("says when the bike is lost, and forgets its last values", async () => {
    const data = new FakeCharacteristic();
    const { device } = fakeDevice({ [FTMS]: { [INDOOR_BIKE_DATA]: data } });
    const onLost = vi.fn();
    const { sensor } = await connectTrainer(device, onLost);
    data.notify(FTMS_90_RPM);

    device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(onLost).toHaveBeenCalledOnce();
    expect(sensor.read(performance.now())).toEqual({ cadence: 0, power: 0 });
  });

  it("stops listening once detached, and disconnects on request", async () => {
    const data = new FakeCharacteristic();
    const { device, disconnect } = fakeDevice({ [FTMS]: { [INDOOR_BIKE_DATA]: data } });
    const onLost = vi.fn();
    const { sensor } = await connectTrainer(device, onLost);

    sensor.detach();
    data.notify(FTMS_90_RPM);
    device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(sensor.read(performance.now()).cadence).toBe(0);
    expect(onLost).not.toHaveBeenCalled();
    sensor.disconnect();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe("connectTrainer slope control", () => {
  function controllableTrainer(range?: DataView, feature = CAN_SET_RESISTANCE) {
    const controlPoint = new FakeCharacteristic();
    const characteristics: Partial<Record<number, FakeCharacteristic>> = {
      [INDOOR_BIKE_DATA]: new FakeCharacteristic(),
      [FTMS_FEATURE]: new FakeCharacteristic(feature),
      [CONTROL_POINT]: controlPoint,
      [RESISTANCE_RANGE]: new FakeCharacteristic(range),
    };
    return { ...fakeDevice({ [FTMS]: characteristics }), controlPoint };
  }

  it("sends the grade to a trainer with simulation", async () => {
    const { device, controlPoint } = controllableTrainer(undefined, CAN_SIMULATE);
    const { sensor, controllable } = await connectTrainer(device, () => undefined);
    expect(controllable).toBe(true);
    expect(await sensor.setSlope?.(5)).toBe(true);
    expect(controlPoint.written.at(-1)).toEqual([...encodeSetSimulation(5)]);
  });

  it("without simulation, sets the resistance within the trainer's own range", async () => {
    const range = view(...u16(0), ...u16(100), ...u16(10));
    const { device, controlPoint } = controllableTrainer(range);
    const { sensor, controllable } = await connectTrainer(device, () => undefined);
    expect(controllable).toBe(true);

    expect(await sensor.setSlope?.(5)).toBe(true);
    const level = resistanceLevel(5, { min: 0, max: 100, increment: 10 });
    expect(controlPoint.written).toEqual([
      [OP_REQUEST_CONTROL],
      [OP_START],
      [...encodeSetResistance(level)],
    ]);
  });

  it("keeps the default range when the trainer does not give one", async () => {
    const { device, controlPoint } = controllableTrainer();
    const { sensor } = await connectTrainer(device, () => undefined);
    expect(await sensor.setSlope?.(5)).toBe(true);
    expect(controlPoint.written.at(-1)).toEqual([...encodeSetResistance(25)]);
  });

  it("leaves the trainer alone when it cannot be set", async () => {
    const plain = fakeDevice({
      [FTMS]: {
        [INDOOR_BIKE_DATA]: new FakeCharacteristic(),
        [FTMS_FEATURE]: new FakeCharacteristic(view(0, 0, 0, 0, 0, 0, 0, 0)),
      },
    });
    const connection = await connectTrainer(plain.device, () => undefined);
    expect(connection.controllable).toBe(false);
    expect("setSlope" in connection.sensor).toBe(false);

    // No feature characteristic at all: still a working bike, just not controlled.
    const minimal = fakeDevice({ [FTMS]: { [INDOOR_BIKE_DATA]: new FakeCharacteristic() } });
    expect((await connectTrainer(minimal.device, () => undefined)).controllable).toBe(false);
  });
});

describe("requestTrainer", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "bluetooth");
  });

  const withPicker = (requestDevice: () => Promise<unknown>) => {
    Object.defineProperty(navigator, "bluetooth", { value: { requestDevice }, configurable: true });
  };

  it("asks for any of the three bike services", async () => {
    const requestDevice = vi.fn(() => Promise.resolve({ name: "KICKR" }));
    withPicker(requestDevice);
    await requestTrainer();
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [FTMS] }, { services: [CYCLING_POWER] }, { services: [CSC] }],
      optionalServices: [FTMS, CYCLING_POWER, CSC],
    });
  });

  it("tells a closed picker from a real failure", async () => {
    withPicker(() => Promise.reject(new DOMException("User cancelled", "NotFoundError")));
    expect(await failure(requestTrainer())).toBe("cancelled");
    withPicker(() => Promise.reject(new DOMException("Adapter off", "NotAllowedError")));
    expect(await failure(requestTrainer())).toBe("failed");
  });

  it("says when the browser has no Bluetooth", async () => {
    expect(await failure(requestTrainer())).toBe("unsupported");
  });
});

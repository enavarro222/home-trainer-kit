import { useEffect, useState } from "react";
import type { ControlAction, SensorReading, SensorState, ZwiftControllerState } from "../src";
import {
  DEFAULT_DRIVETRAIN,
  DemoSensor,
  VIRTUAL_RATIOS,
  ZERO_READING,
  gearFactor,
  isBluetoothSupported,
  neutralGear,
  realRatio,
  shift,
  useControls,
  useGamepadControls,
  useSensor,
  useZwiftController,
} from "../src";

const ACTION_LABELS: Record<ControlAction, string> = {
  left: "← gauche",
  right: "droite →",
  select: "valider (A)",
  gearUp: "vitesse +",
  gearDown: "vitesse −",
  powerUp: "haut",
  powerDown: "bas",
};

const SLOPE_CONTROL: Record<"simulation" | "resistance", string> = {
  simulation: "pente simulée (FTMS 0x11) : le mieux",
  resistance: "niveau de résistance (FTMS 0x04) : approximatif",
};

/** A test bench: is this trainer, remote or gamepad usable by the games? */
export function App() {
  const trainer = useSensor();
  const remote = useZwiftController();
  useGamepadControls();

  return (
    <main>
      <header>
        <h1>Testeur de home trainer</h1>
        <p>
          Vérifie qu&apos;un home trainer connecté, une télécommande Zwift ou une manette marchent
          avec les jeux (contour, Sonne la Cloche). Chrome ou Edge sur ordinateur, ou Chrome sur
          Android : il faut le Bluetooth du navigateur.
        </p>
      </header>
      {!isBluetoothSupported() && (
        <p className="warning" role="alert">
          Ce navigateur n&apos;a pas de Bluetooth (Web Bluetooth) : home trainer et télécommande ne
          peuvent pas se connecter. La manette marche quand même.
        </p>
      )}
      <TrainerCard trainer={trainer} />
      <RemoteCard remote={remote} />
      <ActionLog />
    </main>
  );
}

function TrainerCard({ trainer }: { trainer: SensorState }) {
  const { sensor, connection } = trainer;
  const reading = useLiveReading(trainer);
  return (
    <section className="card" aria-labelledby="trainer-title">
      <h2 id="trainer-title">Home trainer</h2>
      {connection.kind === "none" ? (
        <p>Pas encore connecté.</p>
      ) : connection.kind === "demo" ? (
        <p>Démo sans matériel : pédale avec ← et → en alternance.</p>
      ) : (
        <dl>
          <dt>Appareil</dt>
          <dd>{connection.deviceName || "sans nom"}</dd>
          <dt>Protocole</dt>
          <dd>{connection.protocol}</dd>
          <dt>Pente pilotable</dt>
          <dd>
            {connection.slopeControl
              ? SLOPE_CONTROL[connection.slopeControl]
              : "non (lecture seule)"}
          </dd>
          <dt>État</dt>
          <dd>{connection.lost ? "connexion perdue" : "connecté"}</dd>
        </dl>
      )}
      <div className="row">
        <button
          type="button"
          disabled={trainer.connecting || !isBluetoothSupported()}
          onClick={() => void trainer.connect()}
        >
          {trainer.connecting ? "Connexion…" : "Connecter un home trainer"}
        </button>
        {connection.kind === "bluetooth" && connection.lost && (
          <button type="button" onClick={() => void trainer.reconnect()}>
            Reconnecter
          </button>
        )}
        <button type="button" onClick={trainer.startDemo}>
          Essayer sans matériel
        </button>
      </div>
      {trainer.error && (
        <p className="warning" role="alert">
          {trainer.error.code === "cancelled"
            ? "Aucun appareil choisi."
            : trainer.error.code === "noData"
              ? "L'appareil ne donne pas de données. Est-il déjà relié à Zwift ou à une montre ?"
              : `La connexion a échoué (${trainer.error.message}).`}
        </p>
      )}
      {sensor && (
        <>
          <div className="gauges">
            <Gauge label="Puissance" value={Math.round(reading.power)} unit="W" />
            <Gauge label="Cadence" value={Math.round(reading.cadence)} unit="tr/min" />
            <Gauge
              label="Mesure la puissance"
              value={sensor.measuresPower() ? "oui" : "non"}
              unit=""
            />
          </div>
          {sensor.setSlope && <SlopeControl state={trainer} />}
        </>
      )}
    </section>
  );
}

/** The sensor's reading, four times a second; ← → pedal the demo sensor. */
function useLiveReading({ sensor }: SensorState): SensorReading {
  const [reading, setReading] = useState<SensorReading>(ZERO_READING);
  useEffect(() => {
    if (!(sensor instanceof DemoSensor)) return;
    const onKey = (event: KeyboardEvent) => {
      const foot = event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : null;
      if (foot) sensor.step(foot, performance.now());
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, [sensor]);
  useEffect(() => {
    if (!sensor) return;
    const id = setInterval(() => {
      setReading(sensor.read(performance.now()));
    }, 250);
    return () => {
      clearInterval(id);
    };
  }, [sensor]);
  return sensor ? reading : ZERO_READING;
}

function Gauge({ label, value, unit }: { label: string; value: number | string; unit: string }) {
  return (
    <div className="gauge">
      <span className="label">{label}</span>
      <span className="value">
        {value}
        {unit && <small> {unit}</small>}
      </span>
    </div>
  );
}

type Sent = "pending" | "ok" | "refused" | null;

/** A slope to feel, and virtual gears to try on a single cog. */
function SlopeControl({ state }: { state: SensorState }) {
  const sensor = state.sensor;
  const [slope, setSlope] = useState(0);
  const [slopeSent, setSlopeSent] = useState<Sent>(null);
  const [gears, setGears] = useState(false);
  const [drivetrain, setDrivetrain] = useState(DEFAULT_DRIVETRAIN);
  const [gear, setGear] = useState(() => neutralGear(DEFAULT_DRIVETRAIN));
  const [gearSent, setGearSent] = useState<Sent>(null);

  // Sent once the slider rests: a trainer takes one command at a time.
  useEffect(() => {
    if (!sensor?.setSlope) return;
    const id = setTimeout(() => {
      setSlopeSent("pending");
      void sensor.setSlope?.(slope).then((ok) => {
        setSlopeSent(ok ? "ok" : "refused");
      });
    }, 300);
    return () => {
      clearTimeout(id);
    };
  }, [sensor, slope]);

  useEffect(() => {
    if (!sensor?.setGear) return;
    void sensor.setGear(gears ? gearFactor(gear, drivetrain) : 1).then((ok) => {
      setGearSent(ok ? "ok" : "refused");
    });
  }, [sensor, gears, gear, drivetrain]);

  useControls({
    gearUp: () => {
      if (gears) setGear((g) => shift(g, 1));
    },
    gearDown: () => {
      if (gears) setGear((g) => shift(g, -1));
    },
    powerUp: () => {
      setSlope((s) => Math.min(15, s + 1));
    },
    powerDown: () => {
      setSlope((s) => Math.max(-5, s - 1));
    },
  });

  return (
    <div className="controls">
      <label>
        Pente envoyée : <strong>{slope} %</strong> <Status sent={slopeSent} />
        <input
          type="range"
          min={-5}
          max={15}
          step={1}
          value={slope}
          onChange={(event) => {
            setSlope(Number(event.target.value));
          }}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={gears}
          onChange={(event) => {
            setGears(event.target.checked);
          }}
        />
        Vitesses virtuelles (un seul pignon : Zwift Cog…)
      </label>
      {gears && (
        <div className="gears">
          <label>
            Plateau
            <input
              type="number"
              min={20}
              max={60}
              value={drivetrain.chainring}
              onChange={(event) => {
                setDrivetrain((d) => ({
                  ...d,
                  chainring: Number(event.target.value) || d.chainring,
                }));
              }}
            />
          </label>
          <label>
            Pignon
            <input
              type="number"
              min={9}
              max={40}
              value={drivetrain.cog}
              onChange={(event) => {
                setDrivetrain((d) => ({ ...d, cog: Number(event.target.value) || d.cog }));
              }}
            />
          </label>
          <div className="row">
            <button
              type="button"
              aria-label="Vitesse plus facile"
              onClick={() => {
                setGear((g) => shift(g, -1));
              }}
            >
              −
            </button>
            <span>
              Vitesse <strong>{gear + 1}</strong> / {VIRTUAL_RATIOS.length} · rapport{" "}
              {(VIRTUAL_RATIOS[gear] ?? 1).toFixed(2)} (réel {realRatio(drivetrain).toFixed(2)}) ·
              facteur {gearFactor(gear, drivetrain).toFixed(2)} <Status sent={gearSent} />
            </span>
            <button
              type="button"
              aria-label="Vitesse plus dure"
              onClick={() => {
                setGear((g) => shift(g, 1));
              }}
            >
              +
            </button>
          </div>
        </div>
      )}
      <p className="hint">
        Les jeux réduisent la pente (« difficulté », 50 % par défaut) : ici, elle part telle quelle.
        Une manette ou une télécommande change la pente (haut / bas) et la vitesse (+ / −).
      </p>
    </div>
  );
}

function Status({ sent }: { sent: Sent }) {
  if (sent === null) return null;
  const text = { pending: "envoi…", ok: "acceptée", refused: "refusée" }[sent];
  return <span className={`status ${sent}`}>{text}</span>;
}

function RemoteCard({ remote }: { remote: ZwiftControllerState }) {
  return (
    <section className="card" aria-labelledby="remote-title">
      <h2 id="remote-title">Télécommande Zwift (Click, Click v2, Ride)</h2>
      <p>
        {remote.name
          ? `${remote.name} · ${remote.lost ? "connexion perdue" : "connectée"}`
          : "Ferme d'abord Zwift, Zwift Companion ou BikeControl : une télécommande n'accepte qu'une connexion."}
      </p>
      <button
        type="button"
        disabled={remote.connecting || !remote.supported}
        onClick={() => void remote.connect()}
      >
        {remote.connecting
          ? "Connexion…"
          : remote.name
            ? "Reconnecter"
            : "Connecter une télécommande Zwift"}
      </button>
      {remote.error && (
        <p className="warning" role="alert">
          La connexion a échoué ({remote.error}).
        </p>
      )}
      <p className="hint">
        Appuie sur chaque bouton : il doit apparaître dans le journal ci-dessous. Protocole non
        officiel : si un bouton ne répond pas, note le modèle et le bouton.
      </p>
    </section>
  );
}

interface Logged {
  readonly id: number;
  readonly action: ControlAction;
  readonly at: string;
}

/** Every handlebar action received, from the gamepad or a remote. */
function ActionLog() {
  const [log, setLog] = useState<Logged[]>([]);
  const add = (action: ControlAction) => () => {
    setLog((l) => [
      { id: (l[0]?.id ?? 0) + 1, action, at: new Date().toLocaleTimeString("fr-FR") },
      ...l.slice(0, 11),
    ]);
  };
  useControls({
    left: add("left"),
    right: add("right"),
    select: add("select"),
    gearUp: add("gearUp"),
    gearDown: add("gearDown"),
    powerUp: add("powerUp"),
    powerDown: add("powerDown"),
  });
  return (
    <section className="card" aria-labelledby="log-title">
      <h2 id="log-title">Manette et télécommande : journal</h2>
      <p className="hint">
        Manette : rien à connecter, appuie sur un bouton. Croix : gauche / droite · gâchettes :
        vitesses · A ou Start : valider · X / Y : bas / haut.
      </p>
      {log.length === 0 ? (
        <p>Aucune action reçue pour l&apos;instant.</p>
      ) : (
        <ol className="log" aria-live="polite">
          {log.map((l) => (
            <li key={l.id}>
              <span>{l.at}</span> {ACTION_LABELS[l.action]}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

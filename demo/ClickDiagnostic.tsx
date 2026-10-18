import { useEffect, useRef, useState } from "react";
import type { ZwiftController } from "../src";
import {
  RIDE_ON,
  ZWIFT_DEVICE_TYPES,
  connectZwiftController,
  decodeButtons,
  requestZwiftController,
} from "../src";

/** What to pick in the browser list: a side of a Click v2, or any Zwift controller. */
const PICKS = [
  { label: "Boîtier droit (0x0A)", side: "droit", type: ZWIFT_DEVICE_TYPES.clickV2Right },
  { label: "Boîtier gauche (0x0B)", side: "gauche", type: ZWIFT_DEVICE_TYPES.clickV2Left },
  { label: "N'importe laquelle", side: "?", type: undefined },
] as const;

/** The start command BikeControl writes to a Click v2: RideOn, then 02 03. */
const CLICK_V2_HELLO = new Uint8Array([...RIDE_ON, 0x02, 0x03]);

/** Between two automatic reconnection attempts, ms. */
const AUTO_RETRY_MS = 2000;

interface Entry {
  /** Seconds since the page opened. */
  t: number;
  who: string;
  text: string;
}

/** A controller picked: kept once lost, to reconnect it without the browser list. */
interface Link {
  who: string;
  device: BluetoothDevice;
  controller: ZwiftController | null;
  connecting: boolean;
  /** Tries again every AUTO_RETRY_MS while lost. */
  auto: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Watching the device's advertisements while lost (Chrome may not allow it). */
  watching: boolean;
}

const PAGE_START = performance.now();
/** Seconds since the page opened. */
const elapsed = () => (performance.now() - PAGE_START) / 1000;

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");

const isRideOn = (bytes: Uint8Array) =>
  bytes.length === RIDE_ON.length && bytes.every((b, i) => b === RIDE_ON[i]);

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A Click v2 bench: connect each side on its own (picked by its type byte),
 * and log every raw message, press, connection and loss, with the time. A
 * lost side is kept, to reconnect it by hand or every 2 s.
 * Not the games' path (useZwiftController): connect remotes here or there.
 */
export function ClickDiagnostic() {
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [v2Hello, setV2Hello] = useState(false);
  const v2HelloRef = useRef(false);
  useEffect(() => {
    v2HelloRef.current = v2Hello;
  }, [v2Hello]);
  // Links live in a ref (callbacks from the device read them); the screen
  // shows a copy of them, taken on each change.
  const links = useRef<Link[]>([]);
  const [shown, setShown] = useState<
    { who: string; connecting: boolean; connected: boolean; auto: boolean }[]
  >([]);
  const refresh = () => {
    setShown(
      links.current.map((l) => ({
        who: l.who,
        connecting: l.connecting,
        connected: l.controller !== null,
        auto: l.auto,
      })),
    );
  };
  const linkOf = (who: string) => links.current.find((l) => l.who === who);
  const logRef = useRef<HTMLPreElement>(null);

  // The latest line always in sight, as it comes.
  useEffect(() => {
    const pre = logRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [log]);
  useEffect(
    () => () => {
      for (const l of links.current) {
        if (l.timer !== null) clearTimeout(l.timer);
        l.controller?.disconnect();
      }
    },
    [],
  );

  const add = (who: string, text: string) => {
    const t = elapsed();
    setLog((all) => [...all, { t, who, text }]);
  };

  /** While lost: is it advertising again (after a press wakes it)? If so, connect. */
  const watch = async (link: Link) => {
    const device = link.device;
    if (link.watching) return;
    if (!("watchAdvertisements" in device)) {
      add(link.who, "écoute des annonces : non disponible dans ce Chrome");
      return;
    }
    const onAdvert = (event: Event) => {
      const rssi = (event as Event & { rssi?: number }).rssi;
      add(link.who, `📡 annonce reçue (rssi ${rssi ?? "?"})`);
      if (!link.controller && !link.connecting && links.current.includes(link)) {
        void open(link, true);
      }
    };
    try {
      device.addEventListener("advertisementreceived", onAdvert);
      await device.watchAdvertisements();
      link.watching = true;
      add(link.who, "écoute des annonces : en cours");
    } catch (e) {
      device.removeEventListener("advertisementreceived", onAdvert);
      add(link.who, `écoute des annonces : échec (${messageOf(e)})`);
    }
  };

  const scheduleRetry = (link: Link) => {
    if (!link.auto || link.controller || link.timer !== null) return;
    link.timer = setTimeout(() => {
      link.timer = null;
      if (link.auto && !link.controller && links.current.includes(link)) void open(link, true);
    }, AUTO_RETRY_MS);
  };

  /** Connects `link`'s device; `auto` for a retry, logged more briefly. */
  const open = async (link: Link, auto = false) => {
    if (link.connecting) return;
    link.connecting = true;
    refresh();
    const { who } = link;
    add(who, auto ? "reconnexion auto…" : "connexion…");
    let rideOnSeen = false;
    try {
      const controller = await connectZwiftController(
        link.device,
        () => undefined,
        () => {
          add(who, "⚠ DÉCONNECTÉ");
          link.controller = null;
          refresh();
          scheduleRetry(link);
          void watch(link);
        },
        {
          hello: v2HelloRef.current ? CLICK_V2_HELLO : RIDE_ON,
          onMessage: (channel, bytes) => {
            if (channel === "answers") {
              // RideOn comes back every 3 s: only the first one, and anything else.
              if (isRideOn(bytes) && rideOnSeen) return;
              rideOnSeen ||= isRideOn(bytes);
              add(
                who,
                `réponse ${hex(bytes)}${isRideOn(bytes) ? " (RideOn, suivants masqués)" : ""}`,
              );
              return;
            }
            const buttons = decodeButtons(bytes);
            const held = buttons ? [...buttons].join("+") || "relâché" : "?";
            // Releases repeat for a second after each press: only the press.
            if (held === "relâché") return;
            add(who, `boutons ${hex(bytes)} → ${held}`);
          },
        },
      );
      link.controller = controller;
      add(who, `✓ connecté (${v2HelloRef.current ? "RideOn + 02 03" : "RideOn"})`);
    } catch (e) {
      add(who, `échec : ${messageOf(e)}`);
      scheduleRetry(link);
    } finally {
      link.connecting = false;
      refresh();
    }
  };

  const pick = async (side: string, type: number | undefined) => {
    setBusy(true);
    try {
      const device = await requestZwiftController(type);
      const known = links.current.find((l) => l.device === device);
      if (known) {
        add(known.who, "déjà dans la liste");
        if (!known.controller) await open(known);
        return;
      }
      const link: Link = {
        who: `${side} ${device.name ?? "?"} ${device.id.slice(0, 6)}`,
        device,
        controller: null,
        connecting: false,
        auto: false,
        timer: null,
        watching: false,
      };
      links.current = [...links.current, link];
      add(link.who, "choisi");
      await open(link);
    } catch (e) {
      add("—", `échec : ${messageOf(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const forget = (link: Link) => {
    link.auto = false;
    if (link.timer !== null) clearTimeout(link.timer);
    link.timer = null;
    if (link.controller) add(link.who, "déconnexion demandée");
    link.controller?.disconnect();
    link.controller = null;
    links.current = links.current.filter((l) => l !== link);
    refresh();
  };

  const text = log.map((e) => `${e.t.toFixed(2)}s\t${e.who}\t${e.text}`).join("\n");

  return (
    <section className="card" aria-labelledby="diag-title">
      <h2 id="diag-title">Diagnostic Zwift Click v2</h2>
      <p className="hint">
        Un boîtier perdu reste dans la liste : « Reconnecter » le reprend sans la liste du
        navigateur, « Retenter tout seul » essaie toutes les 2 s. Les relâchements et les RideOn
        répétés ne sont pas journalisés. N&apos;utilise pas la carte « Télécommande » au-dessus en
        même temps.
      </p>
      <label>
        <input
          type="checkbox"
          checked={v2Hello}
          onChange={(event) => {
            setV2Hello(event.target.checked);
          }}
        />{" "}
        Démarrage Click v2 : RideOn + 02 03 (comme BikeControl), aux prochaines connexions
      </label>
      <div className="row">
        {PICKS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="plain"
            disabled={busy}
            onClick={() => void pick(p.side, p.type)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {shown.length > 0 && (
        <ul>
          {shown.map((l) => (
            <li key={l.who}>
              <strong>{l.who}</strong> ·{" "}
              {l.connecting ? "connexion…" : l.connected ? "connecté" : "PERDU"}{" "}
              <label>
                <input
                  type="checkbox"
                  checked={l.auto}
                  onChange={(event) => {
                    const link = linkOf(l.who);
                    if (!link) return;
                    link.auto = event.target.checked;
                    add(
                      link.who,
                      link.auto ? "retenter tout seul : oui" : "retenter tout seul : non",
                    );
                    if (!link.auto && link.timer !== null) {
                      clearTimeout(link.timer);
                      link.timer = null;
                    }
                    scheduleRetry(link);
                    refresh();
                  }}
                />{" "}
                Retenter tout seul
              </label>{" "}
              {!l.connected && (
                <button
                  type="button"
                  className="plain"
                  disabled={l.connecting}
                  onClick={() => {
                    const link = linkOf(l.who);
                    if (link) void open(link);
                  }}
                >
                  Reconnecter
                </button>
              )}{" "}
              <button
                type="button"
                className="plain"
                onClick={() => {
                  const link = linkOf(l.who);
                  if (link) forget(link);
                }}
              >
                Oublier
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          className="plain"
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          Copier le journal
        </button>
        <button
          type="button"
          className="plain"
          onClick={() => {
            add("—", "──── nouvel essai ────");
          }}
        >
          Marquer un nouvel essai
        </button>
        <button
          type="button"
          className="plain"
          onClick={() => {
            setLog([]);
          }}
        >
          Vider
        </button>
      </div>
      <pre className="rawlog" ref={logRef} aria-label="Journal">
        {text || "Rien pour l'instant."}
      </pre>
    </section>
  );
}

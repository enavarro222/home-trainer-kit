# home-trainer-kit

Smart trainers, virtual gears and handlebar controls for **browser** home trainer games, over Web
Bluetooth. Shared by [Sonne la Cloche](https://github.com/enavarro222/sonne_la_cloche) and _Lignes de
niveau_.

**[Test app](https://enavarro222.github.io/home-trainer-kit/)**: check that a smart trainer, a Zwift
remote or a gamepad works, before riding. Chrome or Edge on a computer, or Chrome on Android (Web
Bluetooth: no iOS).

## What's inside

- **Smart trainers**: FTMS (power, cadence, simulated grade or resistance level), Cycling Power, CSC.
  Reconnection, a power meter that is presumed to measure until pedaling says otherwise, and a demo
  sensor to pedal with the ← → keys.
- **Virtual gears**, for trainers with a single cog (Zwift Cog and the like). A virtual gear `k` times
  bigger than the real one must make the trainer resist with `k·F(k·v)` at its own speed `v`: with the
  FTMS road model, grade × k, Crr × k and wind coefficient × k³. 24 gears from 0.75 to 5.49, starting
  on the one closest to the real ratio. With a real cassette, don't call `setGear`: nothing changes.
- **Handlebar controls**: sources emit actions (`left`, `right`, `select`, `gearUp`, `gearDown`,
  `powerUp`, `powerDown`) that screens listen to with `useControls`. Sources: gamepads (standard
  mapping) and Zwift remotes (Click, Click v2, Ride).

### Zwift remotes: caveats

Zwift doesn't publish the protocol: this follows reverse engineering
([makinolo](https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/),
[zwiftboard](https://github.com/thomaschampagne/zwiftboard),
[zwiftplay](https://github.com/ajchellew/zwiftplay)), and a firmware update may break it. A remote
takes one connection at a time: close Zwift, Zwift Companion or BikeControl first. The Click v2 is
locked to Zwift's app; which buttons answer without its unlock is still to be checked. Reports
welcome, with the model and the button.

## Use in a game

TypeScript sources, no build step: Vite and Vitest read them as they are.

```sh
pnpm add github:enavarro222/home-trainer-kit#v0.1.0
```

```tsx
import { useControls, useGamepadControls, useSensor, useZwiftController } from "home-trainer-kit";

const trainer = useSensor({ rolling: 0.004, airDrag: 0.19 }); // the game's road model
const remote = useZwiftController(); // remote.connect() from a click
useGamepadControls(); // once, app-wide
useControls({ left: turnLeft, right: turnRight, select: togglePause });
```

`home-trainer-kit/gears` is the pure part (no React), for a game's core. Linked locally
(`link:../home-trainer-kit`), add `resolve: { dedupe: ["react", "react-dom"] }` to the game's Vite
config: the kit has its own dev copy of React.

## Develop

```sh
pnpm install
pnpm dev     # the test app
pnpm check   # format, lint, types, tests
```

## License

MIT

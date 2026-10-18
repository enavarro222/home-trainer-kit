# Zwift Click v2 over Web Bluetooth: field notes

What we measured on a real Click v2, and what others report. Status: in
progress. Measured on Chrome for Linux (desktop) unless stated otherwise;
Android still to be tested. Measured with the test app's "Diagnostic Zwift
Click v2" card (`demo/ClickDiagnostic.tsx`), which logs every raw message.

## The hardware

A Click v2 is two pods, left and right, each a Bluetooth LE device of its
own, both named "Zwift Click". Chrome's device picker shows names only (no
Bluetooth address: Web Bluetooth hides it), so the two look the same.

**Picking a side.** Each pod advertises manufacturer data under Zwift's
company id (`0x094A`); its first byte is the model and side. A
`requestDevice` filter with that byte as `dataPrefix` lists only one side
(`requestZwiftController(ZWIFT_DEVICE_TYPES.clickV2Right)`).

| Byte | Device            | Checked           |
| ---- | ----------------- | ----------------- |
| 0x02 | Zwift Play, right | no                |
| 0x03 | Zwift Play, left  | no                |
| 0x07 | Zwift Ride, right | no                |
| 0x08 | Zwift Ride, left  | no                |
| 0x09 | Zwift Click (v1)  | no                |
| 0x0A | Click v2, right   | **yes**: lists it |
| 0x0B | Click v2, left    | not yet           |

Values from BikeControl's `constants.dart` (which marks the Click v2 ones
as unconfirmed).

**Buttons of the right pod** (measured): +, A, B, Y, Z. The −, the arrows
and the rest are on the left pod. Messages are type `0x23`, a 32-bit field
where a button pressed is a 0 bit; `decodeButtons` reads them right:

```
23 08 ff df ff ff 0f → plus      23 08 ef ff ff ff 0f → a
23 08 df ff ff ff 0f → b         23 08 bf ff ff ff 0f → y
23 08 ff fe ff ff 0f → z         23 08 ff ff ff ff 0f → released
```

A press comes as two identical messages ~0.1 s apart, then about ten
"released" messages over the next second. `newlyPressed` counts it once.

## What we measured

- **The right pod alone works**, without Zwift's unlock: every button of
  the right pod reports, from the first second, over several minutes.
- **The right pod alone does not relay the left pod's buttons.** With only
  the right connected, the left pod's LED keeps blinking (it is looking for
  a link) and its presses never arrive.
- **Both connected: a + counted twice** (seen in the game, before
  presses were deduplicated). One pod seems to relay the other's presses
  once both are linked; not yet measured with the diagnostic.
- **It sleeps after about a minute**, LED off, and the link drops
  (`gattserverdisconnected`). "RideOn" written every 3 s, and answered,
  does not keep it awake, nor does BikeControl's start command (`RideOn`
  `02 03`, echoed back as is). Measured six times: 60.4, 60.5, 60.7, 62 and 65 s
  after the last press, and once 49 s after it (but 60 s after
  connecting: a lone press, one message instead of two, may not reset the
  count). About 10 s before, it sends `ff 05 00 fa 05 …` on the buttons
  characteristic, which BikeControl names `RESPONSE_STOPPED_CLICK_V2`.
  Zwift support says the same of Zwift's own app: a Click sleeps after
  60 s without input.
- **The press that wakes it is lost**: it never reaches the page.
- **Reconnecting without the picker** (`device.gatt.connect()` on the
  device kept), Chrome on Linux:
  - while nothing makes Chrome scan, it fails at once: "Bluetooth Device
    is no longer in range";
  - with `device.watchAdvertisements()` running (it needs
    `chrome://flags/#enable-experimental-web-platform-features`), it
    works once a press wakes the pod. No `advertisementreceived` event was
    logged: the watch seems to make Chrome scan, which lets it find the
    pod again;
  - retried every 2 s: the first attempt after the pod sleeps stays
    **pending** 41 to 43 s, then fails ("Connection attempt failed");
    after that, attempts fail at once ("no longer in range") until the
    pod advertises again;
  - **from the waking press to connected: about 6 s** (press at ~155 s,
    attempts at 155.6 and 157.6 s fail at once, the one at 159.6 s
    connects in 1.8 s). The pod takes a few seconds to be seen again;
    retrying every second would gain one at best.

## What others report

- **BikeControl** (a third-party app driving Zwift controllers) offers a
  "right side only" mode for the Click v2: + shifts up, B shifts down, no
  unlock needed. Otherwise both pods work after an "unlock" by Zwift, an
  encrypted handshake to redo about every 24 h; without it, the left pod
  stops sending buttons after about a minute.
- BikeControl starts a Click v2 with `RideOn` followed by `02 03`
  (`RESPONSE_START_CLICK_V2`). The pod echoes it back; it does not keep
  it awake (measured).
- Zwift links the two pods so that they use a single Bluetooth connection
  (a "link" step in Zwift Companion). Which pod carries the other is
  unclear: sources disagree.

## Still to measure

- [x] `RideOn` + `02 03`: no change to the sleep (left pod: not tested).
- [x] Waking with "Retry on its own" (every 2 s): it reconnects alone,
      about 6 s after the waking press (Chrome on Linux).
- [ ] The left pod alone: buttons, and does it stop after a minute?
- [ ] Both pods: which one relays the other?
- [ ] The same on Chrome for Android (the games' tablet): sleep, and
      reconnecting without the picker (Android may connect to a known
      address without scanning).

## Sources

- BikeControl,
  [constants.dart](https://github.com/OpenBikeControl/bikecontrol/blob/main/lib/bluetooth/devices/zwift/constants.dart),
  [Click v2 with other trainer apps](https://bikecontrol.app/blog/zwift-click-v2-with-other-trainer-apps/),
  [issue #68](https://github.com/OpenBikeControl/bikecontrol/issues/68)
- Zwift forums:
  [Click V2 disconnecting](https://forums.zwift.com/t/zwift-click-v2-disconnecting/657878),
  [Click v2 controls turning off randomly](https://forums.zwift.com/t/click-v2-controls-turning-off-randomly/670385),
  [Zwift Plays unable to link](https://forums.zwift.com/t/zwift-plays-issues-after-latest-update-unable-to-link-solved/668769)

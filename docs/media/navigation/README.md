# Navigation and inspection proof

Six PNGs captured from the running UI in Chromium. The reports use the pinned real HackRF and Corne revisions below. These captures contain no substituted fixture data.

| File                        | Viewport   | State                                                                                                                                                  |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hackrf/map.png`            | 1440 × 900 | Whole design, 469 tiles and 390 changes. Electrical edits has 131 modifications; the header has 173 electrical parts including additions and removals. |
| `hackrf/header-1024.png`    | 1024 × 900 | Electrical remains visible and orange. Nets is hidden.                                                                                                 |
| `hackrf/keyboard-focus.png` | 1440 × 900 | Keyboard focus on U23, direct neighbors and the changed-field readout.                                                                                 |
| `hackrf/u17-inspector.png`  | 1440 × 900 | MAX2839 to MAX2837 value and footprint context above the 51 changed pin rows.                                                                          |
| `corne/touch-reach.png`     | 390 × 844  | Real touch previews rU1 reach. Metadata artwork has neutral fill and status outlines.                                                                  |
| `corne/touch-diff.png`      | 390 × 844  | Touch opens rU1 inspection with map controls hidden, the pin change in view and document scrolling.                                                                             |

Existing instrument captures and the hero are unchanged.

## Reproduce

Use Node 22 or newer. Set `BOARDMAP_BROWSER` to an installed Chromium executable if Playwright's default browser is unavailable. Set `HACKRF_CACHE` and `CORNE_CACHE` to repositories containing the pinned commits. Prior capture commands and source context are in `../instrument/README.md`.

```sh
npm ci
npm test
npm run test:e2e -- --base HEAD --head HEAD
npm run test:e2e -- --fixture
npm run test:e2e -- --fixture --removed
npm run test:e2e -- --repo "$HACKRF_CACHE" \
  --base f6598e7b14b7ec539126479e9c6d095c668a534e \
  --head 3bdc5547004c8244de5f37104410c363854e5634 \
  --out docs/media/navigation/hackrf --navigation
npm run test:e2e -- --repo "$CORNE_CACHE" \
  --base a935f345c5e824aeaaa8f624ae2134fae47e128e \
  --head eaf6e072fe273c2cfd64690de135ddb7ffe870f9 \
  --board pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb \
  --out docs/media/navigation/corne --navigation
```

`--navigation` limits captures to the six states above. Each browser run starts an ephemeral loopback server and closes its browser and server in cleanup.

## Checks

All 30 existing unit tests and all five browser commands pass. Browser assertions cover one Tab stop per component region, arrows and Home/End, native Enter/Space inspection, search through the list to Reach, exact focus restoration after Escape and resizing, gutter hover retention, focus/blur behavior, touch dismissal, and changed-field readouts. Header checks cover 1024 and 720 pixels. Text checks cover actual JetBrains Mono rendering, complete reference bounds, long property keys, rename popover bounds, and faint text contrast of at least 4.5:1 against its backgrounds.

Existing assertions still cover all direct neighbor highlights, dense curve counts, ground and transitive controls, unchanged pads, changed numbered pads, and two unnumbered mounting holes with only the edited hole highlighted in both revisions. The phone regression stores one physical coordinate and sends both taps there. It also opens inspection from the expanded list, checks that the list collapses, checks document scrolling and the first semantic change on the initial phone screen, and verifies Back focuses the same component's map tile with the map in view.

A separate browser page in the synthetic fixture run checks joined assembly flags, absent versus empty string values, the ZD1 Pin 2 GND to VBUS row before other semantic rows, replacement context, and removed sheetmate display grouping. The rename check uses file, parent sheet UUID path and old label, and leaves a same-label part with a different UUID in its original group. The raw removed label remains in the inspector.

Map arrows follow control order, as the on-screen hint states. They do not claim spatial grid navigation. On phones, Back from list-origin inspection focuses the matching map tile because the changes list stays collapsed. Classification, reach, affected counts, legacy assembly migration and population rules are unchanged. Local pad drawings retain their existing approximation limits.

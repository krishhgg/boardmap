# Instrument UI captures

Actual Chromium captures of the pinned real-board comparisons. Each run starts an ephemeral loopback server and closes it afterward. No fixture data replaces the boards in these images.

| Capture                                           | Viewport | State                                                                    |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `hackrf/map.png`, `corne/map.png`                 | 1440×900 | Whole-design map and prioritized changes                                 |
| `hackrf/compact.png`, `corne/compact.png`         | 1280×800 | Compact desktop with visible impact readout and a canvas over 500px tall |
| `hackrf/reach.png`, `corne/reach.png`             | 1440×900 | Largest connected component, direct reach                                |
| `hackrf/diff.png`, `corne/diff.png`               | 1440×900 | Component inspector, changed numbered pads and pin rows                  |
| `hackrf/touch-map.png`, `corne/touch-map.png`     | 390×844  | Touch context with collapsed changes list                                |
| `hackrf/touch-reach.png`, `corne/touch-reach.png` | 390×844  | First-tap reach preview and explicit inspect action                      |
| `hackrf/touch-diff.png`, `corne/touch-diff.png`   | 390×844  | Inspector opened through the touch action                                |

`header-1024.png` checks the visible electrical headline at laptop width. `keyboard-focus.png` shows roving keyboard selection and reach. HackRF's `u17-inspector.png` places the replacement context above its 51 changed pin rows.

`sheet.png` and `board.png` capture drill-in and footprint-center views during the browser regression. `mobile.png` is the ordinary browser's mobile-width state. The `touch-*` captures use a separate context with `hasTouch: true` and `isMobile: true`.

The header's electrical total includes high-priority modifications plus added and removed parts with pads. Raw statuses remain intact. Zero-pad artwork is grouped as metadata, so the grouped removed/added counts can differ from raw status counts.

| Comparison   | Head parts | In view, including removed | Changed | Electrical modifications | Removed group | Added group | Metadata group | Header electrical total |
| ------------ | ---------: | -------------------------: | ------: | -----------------------: | ------------: | ----------: | -------------: | ----------------------: |
| HackRF       |        437 |                        469 |     390 |                       73 |            29 |           9 |            279 |                     111 |
| Corne cherry |        180 |                        184 |      18 |                        6 |             2 |           4 |              6 |                      12 |

HackRF's first electrical rows are U17 with 51 rewired pins, U19 with 19 and U23 with 15. The numbers come from changed numbered pin-net assignments across both revisions. Population transitions and both-present part identifier replacements also qualify for this tier. Verified legacy assembly-metadata migrations and explicitly flagged unconnected fiducials are quiet metadata; raw changes and reach remain unchanged. See [assembly priority](../../assembly-priority.md). DNP and identifier rules have focused unit assertions.

## Reproduce

Set `BOARDMAP_BROWSER` to an installed Chromium executable when Playwright's browser is unavailable. Set `HACKRF_CACHE` and `CORNE_CACHE` to repositories containing the pinned objects. The existing demo script can populate these caches.

```sh
npm ci
npm test
npm run test:e2e -- --fixture
npm run test:e2e -- --fixture --removed
npm run test:e2e -- --repo "$HACKRF_CACHE" \
  --base f6598e7b14b7ec539126479e9c6d095c668a534e \
  --head 3bdc5547004c8244de5f37104410c363854e5634 \
  --out docs/media/instrument/hackrf
npm run test:e2e -- --repo "$CORNE_CACHE" \
  --base a935f345c5e824aeaaa8f624ae2134fae47e128e \
  --head eaf6e072fe273c2cfd64690de135ddb7ffe870f9 \
  --board pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb \
  --out docs/media/instrument/corne
node scripts/capture-demo.mjs "$CORNE_CACHE" --gif
```

All 24 existing engine tests and nine presentation tests passed. Both synthetic browser cases and both real-board cases passed without browser errors. The browser asserts the actual JetBrains Mono platform font through Chromium CDP, full reference-label bounds, computed sidebar classifications, rewired-pin priority, full neighbor highlights, curve counts, changed-only pad colors, the drill disclosure, keyboard focus retention, inspector reach-control updates, changed mechanical-pad highlighting, long property names, open sheet-rename panels, overflow at 720 / 800 / 390px, search and scope filtering, and real touch preview before inspection.

The synthetic drill assertion opens the geometry disclosure, checks pad 2's 0.8 to 1.2 change, and confirms no unchanged pad 1 geometry row. The ZD1 demo separately verifies Pin 2 changes from GND to VBUS.

## Demo and package

`demo-frames/` contains four actual 1440×900 ZD1 review states. `boardmap-demo.gif` holds them for 1.2, 1.2, 2.8 and 2.8 seconds. FFprobe reports 8.000 seconds, 80 frames and 1100×688 pixels. FFmpeg is needed only to rebuild the GIF.

An offline install of the packed tarball passed checks for the HTML, app, helper, CSS, shared mark and mono font routes. Arbitrary asset paths returned 404. The package has zero runtime dependencies and excludes this media directory. The bundled font's OFL notice is installed with it.

These images contain design data from HackRF and Corne. See their source links and license information in the main README and test fixtures. Nonstandard pad shapes remain approximate; no copper or design-rule analysis is implied.

`mechanical-pad-regression.png` is the synthetic regression inspector. The unnumbered mounting-hole drill changes from 1.0 to 1.4 mm and is colored in both revisions. A second unnumbered hole remains unchanged and neutral. The matching regression also covers reordered pads and footprint rotation.

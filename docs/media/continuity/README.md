# Readable sheets and visible return selection

These are actual Chromium captures of the pinned HackRF and Corne comparisons. No fixture data replaces the designs. The changes preserve graph semantics, rail loads and report counts.

| Capture | Viewport | State |
| --- | --- | --- |
| `hackrf/returned-part.png`, `corne/returned-part.png` | 1440 × 900 | Following a named neighbor and clicking Back leaves that component outlined and named in the readout. |
| `hackrf/escape-return.png`, `corne/escape-return.png` | 1440 × 900 | Escape restores the named neighbor and keeps it marked after 500ms with the mouse parked over another tile's eventual position. |
| `hackrf/readable-sheet.png`, `corne/readable-sheet.png` | 1280 × 800 | Scrolled sheet regions with complete references, including the HackRF capacitors that were unnamed at this size. |
| `hackrf/readable-root.png`, `corne/readable-root.png` | 1280 × 800 | Root-sheet references remain readable; the breadcrumb uses the same Root sheet name as the overview. |
| `hackrf/touch-return.png`, `corne/touch-return.png` | 390 × 844 | Touch Back restores the marked part, readout and original viewport position. |
| `hackrf/touch-root.png`, `corne/touch-root.png` | 390 × 844 | Long root-sheet references fit without reducing type below 9px. |
| `corne/board-neighbor-return.png` | 1440 × 1000 | Both populated boards loaded unchanged. Following a neighbor chooses its board, and Back visibly marks that neighbor. |

## Reproduce

Use Node 22+, `npm ci`, and Playwright Chromium. An existing browser can be selected with `BOARDMAP_BROWSER`. Set `HACKRF_CACHE` and `CORNE_CACHE` to local git caches containing the pinned objects, or fetch them with `scripts/demo.mjs` and stop its server before capturing.

```sh
npm test
npm run test:e2e -- --base HEAD --head HEAD
npm run test:e2e -- --fixture
npm run test:e2e -- --fixture --removed
npm run test:e2e -- --repo "$HACKRF_CACHE" \
  --base f6598e7b14b7ec539126479e9c6d095c668a534e \
  --head 3bdc5547004c8244de5f37104410c363854e5634 \
  --out docs/media/continuity/hackrf --continuity
npm run test:e2e -- --repo "$CORNE_CACHE" \
  --base a935f345c5e824aeaaa8f624ae2134fae47e128e \
  --head eaf6e072fe273c2cfd64690de135ddb7ffe870f9 \
  --board pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb \
  --out docs/media/continuity/corne --continuity
npm run test:e2e -- --repo "$CORNE_CACHE" \
  --base eaf6e072fe273c2cfd64690de135ddb7ffe870f9 \
  --head eaf6e072fe273c2cfd64690de135ddb7ffe870f9 \
  --out /tmp/boardmap-return-current --continuity
cp /tmp/boardmap-return-current/board-neighbor-return.png docs/media/continuity/corne/
npm run test:e2e -- --repo "$HACKRF_CACHE" \
  --base f6598e7b14b7ec539126479e9c6d095c668a534e \
  --head 3bdc5547004c8244de5f37104410c363854e5634 \
  --board hardware/LNA915/LNA915.kicad_pcb
node scripts/capture-demo.mjs "$CORNE_CACHE" --gif
```

`--continuity` limits captures to these states. The hero GIF and four frames under `../instrument/` are refreshed from the same running UI. All browsers and ephemeral servers close after each run.

## Observed checks

All 42 unit tests and seven browser commands pass without browser errors. The sheet-sizing helper keeps its viewport floor, honors measured reference fit, and retains 32px minimum touch targets. A column remains the finite growth bound. The two-part `[100, 3]` compactness regression still passes.

The browser checks every valid reference in every drilled HackRF and Corne cherry sheet at 1440 × 900, 1280 × 800, 1024 × 720 and 390 × 844. It requires a complete label at 9px or larger, inside the tile bounds. Desktop sheets scroll inside the workspace. Phone sheets retain document scrolling and the sticky readout. Opening and closing an inspector restores the map dimensions and scroll position when the viewport width is unchanged, and identifies the returned component for mouse, keyboard and touch.

The slow-pointer reproduction originally lost U23 on five of nine accelerated paths to the remaining-net list at 1024 × 720. After the fix, all nine preserve U23. The committed browser regression uses a 1.3-second path, waits in the map/readout gap, and then verifies that resting on U24 retargets. Moving more than four pixels restarts the intent timer; the gap belongs to the same instrument area. Keyboard and touch remain immediate.

A second reproduction exposed a layout-generated pointer entry after Back. With the mouse resting over the inspector, Escape restored U21 briefly and then traced U4 without any pointer movement. Touch Back with a parked mouse reproduced the same failure. The fixed reproduction keeps U21 and C1 marked after 500ms. Pointer entry alone no longer changes the source; real mouse movement still starts the ordinary hover and settle behavior. Browser regressions cover both Escape and mixed mouse/touch Back after the 160ms intent delay.

An offline install of the packed tarball starts the real CLI, loads 469 HackRF components, and opens the 136-component sheet with every reference present. Every observed browser request stays on loopback. The package contains 18 files, no bundled runtime dependencies, and no screenshots or fixtures.

The source designs retain their upstream licenses. See the root README and `test/fixtures/README.md`. Local pad regions remain approximate, and the supplementary board view still shows footprint centers rather than copper routing.

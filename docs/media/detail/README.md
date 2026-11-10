# Named reach and detailed review proof

Actual Chromium captures from pinned HackRF and Corne git objects. The UI reads the full boards; none of these reports substitutes synthetic component data.

| Capture | Viewport | Evidence |
| --- | --- | --- |
| `hackrf/map.png` | 1440 × 900 | Whole design with 469 components, 390 raw changes and 111 electrical changes. |
| `hackrf/reach.png` | 1440 × 900 | U23 reaches 205 neighbors. The readout ranks VCC first with 76 peers, preserving the original source while the net list is read. |
| `hackrf/reached-parts.png` | 1440 × 900 | Inspector disclosure names every reached component by net, including removed components and loads outside the current sheet. |
| `hackrf/laptop-inspector.png` | 1024 × 720 | U17 replacement value, footprint and part number precede its 51 changed pins. The first pin rows are visible. |
| `hackrf/classification.png` | 1440 × 900 | P69's Metadata classification explains the verified legacy DNP/BOM-field migration and keeps its raw rows. |
| `hackrf/touch-sheet.png` | 390 × 844 | Drilled sheet scrolls vertically and every component target measures at least 32 pixels in both dimensions. |
| `hackrf/touch-sheet-preview.png` | 390 × 844 | Sticky readout names the tapped part and keeps its count, leading nets and Open action visible after scrolling. |
| `hackrf/readout-1280.png`, `hackrf/readout-1024.png` | 1280 × 800, 1024 × 720 | Full qualifiers stay visible while remaining nets have their own scroll area. |
| `corne/map.png` | 1440 × 900 | Smaller real PR with 184 components across both revisions, 18 changes and 12 electrical changes. |
| `corne/reach.png` | 1440 × 900 | Rail and signal neighbor counts in the map readout. |
| `corne/reached-parts.png` | 1440 × 900 | Named reachable parts remain inspectable without identifying anonymous map tiles. |
| `corne/touch-sheet.png` | 390 × 844 | Scrolled sheet with readable references and larger touch targets. |
| `corne/touch-sheet-preview.png` | 390 × 844 | The readout stays on screen without covering the original tap point. |
| `corne/readout-1280.png`, `corne/readout-1024.png` | 1280 × 800, 1024 × 720 | Leading rail counts and the complete qualifier text stay outside the remaining-net scroller. |

The refreshed eight-second hero and four frames are in `../instrument/`. Earlier capture directories record prior revisions and their original counts.

## Reproduce

Use Node 22+, run `npm ci`, and install Chromium with `npx playwright install chromium`, or set `BOARDMAP_BROWSER` to an existing executable. Fetch the pinned revisions with `scripts/demo.mjs` and stop its server before capturing. Set `HACKRF_CACHE` and `CORNE_CACHE` to the resulting local git caches.

```sh
npm test
npm run test:e2e -- --base HEAD --head HEAD
npm run test:e2e -- --fixture
npm run test:e2e -- --fixture --removed
npm run test:e2e -- --repo "$HACKRF_CACHE" \
  --base f6598e7b14b7ec539126479e9c6d095c668a534e \
  --head 3bdc5547004c8244de5f37104410c363854e5634 \
  --out docs/media/detail/hackrf --detail
npm run test:e2e -- --repo "$CORNE_CACHE" \
  --base a935f345c5e824aeaaa8f624ae2134fae47e128e \
  --head eaf6e072fe273c2cfd64690de135ddb7ffe870f9 \
  --board pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb \
  --out docs/media/detail/corne --detail
node scripts/capture-demo.mjs "$CORNE_CACHE" --gif
```

`--detail` limits captures to the states listed above. Each run closes its browser and ephemeral loopback server.

## Observed checks

All 40 unit tests and five browser commands pass. Net-group tests cover shared peers appearing on multiple nets, historical source membership, transitive reach and board isolation. Browser assertions compare every named reference against `reach()`, follow a reached reference into its inspector, and verify one Tab stop for the reference group. Net counts are sorted without dropping power loads. Counts describe the union of the two revisions and may overlap between nets.

The desktop readout reserves space for complete qualifiers. Only the remaining-net list scrolls, with its net count visible above it. The readout bounds are checked at 1440, 1280, 1024 and 720 pixels. Crossing an intervening tile briefly does not replace the source; resting on it for 160 milliseconds does. Phone readouts show the leading nets; the inspector retains every net and named load. A scrolled sheet keeps the readout sticky before and after the first tap, so its appearance does not move or cover the tapped component. The U21 regulator regression also checks long net names and its Open action.

Laptop checks cover the first semantic row at 1280 × 800 and 1024 × 720. Corne R8 and R9 remain labeled at 1280 × 800, and J2 remains labeled at 1024 × 720. Text bounds still require whole references at 9 pixels or larger. Mouse drill-in leaves no unrequested component trace; keyboard drill-in still focuses its first component.

Phone checks measure every drilled target, send two taps at one unchanged physical coordinate, and verify Back returns the exact component to the visible viewport. Overview targets remain small; the changes list and scrolling sheet provide precise selection.

The laptop SVG assertion reads both diagrams atomically after a resize. This avoids measuring a detached SVG while the resize handler replaces it, the timing failure observed in CI.

The package dry run contains 18 files, excludes fixtures and media, and bundles no runtime dependencies. An offline tarball install produced the real HackRF report and served the HTML, application script, layout helper, review helper, font and icon successfully. FFprobe reports the refreshed GIF as 8.000 seconds.

The source boards retain their upstream licenses. See `test/fixtures/README.md` and the pinned source links in the root README. Pad regions remain approximate for nonstandard shapes; this change adds no copper, DRC or ERC analysis.

# UI captures

Actual Chromium captures of the running UI on the pinned HackRF PR 1411 and Corne PR 237 comparisons. No fixture data replaces the designs.

| Capture | Viewport | State |
| --- | --- | --- |
| `renames/renames-desktop.png` | 1440 × 900 | The rename pill sits beside the revision. Its panel opens below the header, groups sheet and net labels, and closes with Escape, an outside click or its Close control. |
| `renames/renames-phone.png` | 390 × 844 | The pill shortens to a count. The panel fills the phone width and scrolls inside itself when the list is long. |
| `inspector/inspector-neighbors.png` | 1440 × 900 | U17's 160 neighbors scroll inside the disclosure under sticky net headings. The pad regions stay one scroll away. |
| `inspector/inspector-geometry.png` | 1440 × 900 | Changed pad geometry scrolls inside its own bounded disclosure. Each pad group lists named properties with units, repeated pads share one description, and only changed values carry color. |
| `inspector/inspector-unchanged.png` | 1440 × 900 | An unchanged part has no red or green cells. |
| `inspector/inspector-added.png`, `inspector/inspector-removed.png` | 1440 × 900 | Only the revision that holds the part carries color. The other side shows a muted empty mark. |
| `map/hackrf/map-idle.png`, `map/corne/map-idle.png` | 1440 × 900 | Sheet headers count their electrical changes. The legend counts every tile class in view. The idle readout holds the three largest electrical changes on its title row and the five-mark trace key on one line. |
| `map/hackrf/map-reach.png`, `map/corne/map-reach.png` | 1440 × 900 | Hovering U17 or ZD1 draws curves that leave and meet tiles square to their edges. Neighbors connected only in head are green, neighbors connected only in base are dashed pink, and neighbors connected in both stay blue. Curves fade under part names and pass behind sheet headers, and a dot marks where each one leaves the traced part. On HackRF U17, the VCC and VAA rail loads are tinted without curves. |
| `map/hackrf/hub-reach.png` | 1440 × 900 | U23 has 205 neighbors. Curves are drawn for its changed connections only, and neighbors whose connection did not change are tinted without a ring. |
| `map/corne/hub-reach.png` | 1440 × 900 | Corne U1 would draw 41 curves, so it is traced as a hub: its 2 changed links are drawn and the rest of its neighbors are tinted. |
| `map/hackrf/sheet-reach-detail.png` | 2× crop | U17 inside baseband. Its 5 changed links start at dots inside U17, and the curves stay faintly visible under U18's name. |
| `map/hackrf/rail-reach.png` | 1440 × 900 | R38 joined VCC. Its 62 rail-only neighbors are tinted, and rings and curves mark the three parts it reaches through small nets. A halo marks the traced part. |
| `map/hackrf/sheet.png`, `map/hackrf/sheet-reach.png`, `map/corne/sheet.png`, `map/corne/sheet-reach.png` | 1440 × 900 | A drilled sheet, idle and traced. |
| `map/hackrf/phone-idle.png`, `map/hackrf/phone-preview.png` | 390 × 844 | The phone readout keeps one height. Idle, it holds the instruction and the key. After a tap, it holds the trace with the Open diff action beside the part name. Reach, ground and the view switch share one row, so the map starts in the upper half of the screen. |
| `sidebar/list-desktop.png` | 1440 × 900 | Each change takes two lines, so eleven rows fit where eight did. Group headings stay pinned while the list scrolls. The keyboard help is two lines of key caps. |
| `sidebar/list-selected.png` | 1440 × 900 | The inspected part keeps an orange edge in the list. |
| `sidebar/list-phone.png` | 390 × 844 | The expanded phone list uses the same two-line rows and takes most of the screen. |
| `board/hackrf/board.png`, `board/corne/board.png` | 1440 × 900 | Board layout draws each footprint outline from its pad extents inside a bounding frame. Electrical changes sit on top and carry their references. |
| `board/hackrf/board-reach.png`, `board/corne/board-reach.png` | 1440 × 900 | A trace in Board layout. |
| `board/hackrf/board-phone-nearby.png` | 390 × 844 | A tap 7 pixels off C159 previews it and lists the changes within 30 pixels as full-size buttons under the board. |
| `board/hackrf/board-phone-label-tap.png`, `board/corne/board-phone-label-tap.png` | 390 × 844 | Tapping the name "U18" or "J2" previews that part, not whatever marker sits under the name. |
| `board/corne/board-phone-cluster.png` | 390 px wide, 2× | On the phone, every changed part in Corne's two clusters has its own name. A name that had to move out of the cluster is tied to its marker by a thin line. |
| `board/corne/board-cluster.png` | 2× crop of `board.png` | F1, R8, R9 and ZD1 sit within 20 pixels on the real board. Their markers are spread apart and each has its own label. |
| `board/hackrf/board-phone.png`, `board/corne/board-phone.png` | 390 × 844 | The same view on a phone. The canvas takes the board's shape, so Corne's wide board is not left in a strip of empty canvas. |
| `polish/corne-map.png` | 1440 × 900 | The Metadata legend swatch matches the metadata tiles, and the narrow Root sheet header shows its whole name. |
| `counts/hackrf-map.png`, `counts/corne-map.png` | 1440 × 900 | The header shows 105 electrical as 67 edits, 9 added and 29 removed, the same three numbers as the legend. Each sheet header splits its count the same way. |
| `layout/phone-diff.png` | 390 × 844 | A part diff on a phone. |
| `layout/phone-tiny-part.png` | 390 × 844 | Corne ZD1 is a sliver in the phone overview. One tap opens its sheet with ZD1 previewed and scrolled into view. |

Every capture in this gallery was retaken after the layout change that moved the breadcrumb into the toolbar and the footer under the change list. They were retaken again after the changes from each later council round. At 1440 × 900 the map is now 654 pixels tall, up from 545 before this pass.

Recordings of drill-in, drill-out and curve motion are on the `pr-assets` branch, outside the installed package and the main history.

## Reproduce

Use Node 22+, `npm ci` and Playwright Chromium. Set `HACKRF_CACHE` and `CORNE_CACHE` to git caches that hold the pinned objects. `scripts/demo.mjs` fetches them.

```sh
node scripts/capture-ui.mjs hackrf "$HACKRF_CACHE" OUT_DIR
node scripts/capture-ui.mjs corne "$CORNE_CACHE" OUT_DIR
```

Each run writes every scene into `OUT_DIR`, and the gallery keeps the files named above. The script also takes any of the scenes `renames`, `inspector`, `map`, `board`, `phone` and `motion`. `motion` records the browser and needs FFmpeg to write a GIF.

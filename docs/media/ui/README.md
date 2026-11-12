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
| `map/hackrf/map-idle.png`, `map/corne/map-idle.png` | 1440 × 900 | Sheet headers count their electrical changes. The legend counts every tile class in view. The idle readout holds the five-mark trace key and the three largest electrical changes. |
| `map/hackrf/map-reach.png`, `map/corne/map-reach.png` | 1440 × 900 | Hovering U17 or ZD1 draws curves that leave and meet tiles square to their edges. Neighbors connected only in head are green, neighbors connected only in base are dashed pink, and neighbors connected in both stay blue. Curves pass behind part names and sheet headers. |
| `map/hackrf/sheet.png`, `map/hackrf/sheet-reach.png`, `map/corne/sheet.png`, `map/corne/sheet-reach.png` | 1440 × 900 | A drilled sheet, idle and traced. |
| `map/hackrf/phone-idle.png`, `map/hackrf/phone-preview.png` | 390 × 844 | The phone readout keeps one height. Idle, it holds the key and the starting parts. After a tap, it holds the trace and the Open diff action. Reach, ground and the view switch share one row, so the map starts in the upper half of the screen. |
| `sidebar/list-desktop.png` | 1440 × 900 | Each change takes two lines, so eleven rows fit where eight did. Group headings stay pinned while the list scrolls. The keyboard help is two lines of key caps. |
| `sidebar/list-selected.png` | 1440 × 900 | The inspected part keeps an orange edge in the list. |
| `sidebar/list-phone.png` | 390 × 844 | The expanded phone list uses the same two-line rows and takes most of the screen. |
| `board/hackrf/board.png`, `board/corne/board.png` | 1440 × 900 | Board layout draws each footprint outline from its pad extents inside a bounding frame. Electrical changes sit on top and carry their references. |
| `board/hackrf/board-reach.png`, `board/corne/board-reach.png` | 1440 × 900 | A trace in Board layout. |
| `board/hackrf/board-phone.png` | 390 × 844 | The same view on a phone. |
| `polish/corne-map.png` | 1440 × 900 | The Metadata legend swatch matches the metadata tiles, and the narrow Root sheet header shows its whole name. |
| `counts/hackrf-map.png`, `counts/corne-map.png` | 1440 × 900 | The header shows 105 electrical as 67 edits, 9 added and 29 removed, the same three numbers as the legend. Each sheet header splits its count the same way. |

Recordings of drill-in, drill-out and curve motion are on the `pr-assets` branch, outside the installed package and the main history.

## Reproduce

Use Node 22+, `npm ci` and Playwright Chromium. Set `HACKRF_CACHE` and `CORNE_CACHE` to git caches that hold the pinned objects. `scripts/demo.mjs` fetches them.

```sh
node scripts/capture-ui.mjs hackrf "$HACKRF_CACHE" docs/media/ui/renames renames
node scripts/capture-ui.mjs hackrf "$HACKRF_CACHE" docs/media/ui/inspector inspector
node scripts/capture-ui.mjs hackrf "$HACKRF_CACHE" docs/media/ui/map/hackrf map phone
node scripts/capture-ui.mjs corne "$CORNE_CACHE" docs/media/ui/map/corne map
node scripts/capture-ui.mjs hackrf "$HACKRF_CACHE" docs/media/ui/board/hackrf board
node scripts/capture-ui.mjs corne "$CORNE_CACHE" docs/media/ui/board/corne board
```

The script takes any of the scenes `renames`, `inspector`, `map`, `board`, `phone` and `motion`, and captures all of them when none is named. `motion` records the browser and needs FFmpeg to write a GIF.

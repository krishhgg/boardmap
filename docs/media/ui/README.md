# UI captures

Actual Chromium captures of the running UI on the pinned HackRF PR 1411 and Corne PR 237 comparisons. No fixture data replaces the designs.

| Capture | Viewport | State |
| --- | --- | --- |
| `renames/renames-desktop.png` | 1440 × 900 | The rename pill sits beside the revision. Its panel opens below the header, groups sheet and net labels, and closes with Escape, an outside click or its Close control. |
| `renames/renames-phone.png` | 390 × 844 | The pill shortens to a count. The panel fills the phone width and scrolls inside itself when the list is long. |

## Reproduce

Use Node 22+, `npm ci` and Playwright Chromium. Set `HACKRF_CACHE` and `CORNE_CACHE` to git caches that hold the pinned objects. `scripts/demo.mjs` fetches them.

```sh
node scripts/capture-ui.mjs hackrf "$HACKRF_CACHE" docs/media/ui/renames renames
```

The script takes any of the scenes `renames`, `inspector`, `map`, `phone` and `motion`, and captures all of them when none is named. `motion` records the browser and needs FFmpeg to write a GIF.

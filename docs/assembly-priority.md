# Assembly priority

Boardmap keeps raw fields, attributes, pad changes and pin changes in the report. This page describes their presentation priority.

DNP, BOM exclusion and placement exclusion are separate KiCad attributes. BOM exclusion does not mean unpopulated. See the [file-format specification](https://dev-docs.kicad.org/en/file-formats/sexpr-intro/#_footprint_attributes) and [footprint attribute definitions](https://docs.kicad.org/doxygen/footprint_8h_source.html).

## A bounded legacy migration

HackRF PR #1411 moves a custom `DNP` field into BOM metadata on these verified library features:

- `hackrf:GSG-HOLE126MIL-COPPER`
- `hackrf:GSG-TESTPOINT-50MIL`
- `gsg-modules:0603-JUMPER`

The footprint identity must remain unchanged. One revision has only `exclude_from_pos_files`, custom `DNP="DNP"`, and no `exclude_from_bom` field. The other adds the `exclude_from_bom` attribute and empty field, and clears or removes that custom DNP field. The rule also works in reverse.

Only that custom field's population-priority reason is suppressed. Native DNP flags, additional population fields, both-present MPN replacements, and independent pin, pad, value or footprint changes keep electrical priority. Unknown footprints retain the conservative population classification. Every raw diff row remains visible, including placement changes.

In the pinned HackRF comparison, 72 features have this migration. Of those, 58 have no independent electrical edit; 14 still have pin or value changes. All 11 ordinary-component population transitions remain electrical. For example, [J4](https://github.com/greatscottgadgets/hackrf/blob/3bdc5547004c8244de5f37104410c363854e5634/hardware/hackrf-one/hackrf-one.kicad_pcb#L6380) and [P6](https://github.com/greatscottgadgets/hackrf/blob/3bdc5547004c8244de5f37104410c363854e5634/hardware/hackrf-one/hackrf-one.kicad_pcb#L7195) are board features. JP1's schematic remains a solder jumper while its BOM flag changes, as shown [before](https://github.com/greatscottgadgets/hackrf/blob/f6598e7b14b7ec539126479e9c6d095c668a534e/hardware/hackrf-one/frontend.kicad_sch#L9231) and [after](https://github.com/greatscottgadgets/hackrf/blob/3bdc5547004c8244de5f37104410c363854e5634/hardware/hackrf-one/frontend.kicad_sch#L9649).

## Fiducials

Added or removed fiducial and mark footprints are metadata only when they are explicitly board-only and BOM-excluded, and every pad is circular SMD, unnumbered and unconnected. Unnumbered pads alone are insufficient. Other mechanical additions and removals remain prominent. Modified pad geometry retains electrical priority.

This quiets four verified HackRF fiducials. Its electrical total becomes 111: 73 modified, 29 removed and 9 added. The 279 metadata changes remain in the sidebar and map. The raw changed total is still 390, and the unchanged affected total is still 61. Corne cherry remains at 12 electrical and 18 raw changes.

The tests use extracted real J4, P6, JP1 and C70 footprint expressions, in both comparison directions. They also cover unknown components, native DNP while BOM-excluded, additional population fields, simultaneous MPN changes, independent electrical edits, and mechanical pads. Connectivity and power-rail reach are unchanged.

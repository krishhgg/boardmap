import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBoard } from "../src/board.js";
import { compare } from "../src/compare.js";
import {
  changeGroup,
  changedPins,
  changedPadNumbers,
  orderedChanges,
  isElectrical,
  changedMechanicalPads,
  propertyPriority,
  propertyReasons,
  padFacts,
  padBundles,
  pairBundles,
} from "../web/review.js";
const part = (changes = [], extra = {}) => ({
  status: "modified",
  pads: [{ number: "1" }, { number: "2" }],
  before: {},
  after: {},
  changes,
  ...extra,
});

const assemblyBoard = (revision) => readBoard(
  readFileSync(new URL(`./fixtures/hackrf/assembly-${revision}.kicad_pcb`, import.meta.url), "utf8"),
  "assembly.kicad_pcb",
);
test("population and part-identifier reasons are both preserved", () => {
  const change = { field: "fields", before: { DNP: "", MPN: "OLD" },
    after: { DNP: "DNP", MPN: "NEW" } };
  assert.deepEqual(propertyReasons(change), ["population", "part identifier"]);
  assert.equal(propertyPriority(change), "population");
});
test("real legacy board features migrate metadata without hiding a population change", () => {
  const before = assemblyBoard("before"), after = assemblyBoard("after");
  for (const [a, b] of [[before, after], [after, before]]) {
    const report = compare(a, b);
    const original = JSON.stringify(report);
    for (const ref of ["J4", "P6", "JP1"]) {
      const p = report.parts.find((p) => p.ref === ref);
      assert.equal(changeGroup(p), "Metadata", ref);
      assert.equal(propertyPriority(p.changes.find((c) => c.field === "fields"), p), null);
      assert.ok(p.changes.some((c) => c.field === "attributes"));
    }
    const c70 = report.parts.find((p) => p.ref === "C70");
    assert.equal(changeGroup(c70), "Electrical");
    assert.equal(propertyPriority(c70.changes.find((c) => c.field === "fields"), c70), "population");
    assert.equal(report.stats.changed, 4);
    assert.equal(JSON.stringify(report), original, "classification preserves every raw diff");
  }
});

test("legacy migration guards preserve unknown parts and independent electrical edits", () => {
  const a = assemblyBoard("before").find((p) => p.ref === "J4");
  const b = assemblyBoard("after").find((p) => p.ref === "J4");
  const reportPart = (a, b) => {
    const peer = { ...a, ref: "PEER" };
    return compare([a, peer], [b, peer]).parts.find((p) => p.ref === a.ref);
  };
  const ordinaryA = { ...a, footprint: "Custom:OrdinaryPart" };
  const ordinaryB = { ...b, footprint: "Custom:OrdinaryPart" };
  assert.equal(changeGroup(reportPart(ordinaryA, ordinaryB)), "Electrical");
  assert.equal(propertyPriority({ field: "attributes", before: ["exclude_from_bom"],
    after: ["exclude_from_bom", "dnp"] }), "population");
  for (const edit of [
    (p) => { p.value = "Different value"; },
    (p) => { p.pads[0].w += 0.2; },
    (p) => { p.pins["1"] = ["/NEW"]; p.pads[0].net = "/NEW"; },
    (p) => { p.fields.DoNotPlace = "true"; },
  ]) {
    const fresh = structuredClone(b);
    edit(fresh);
    assert.equal(changeGroup(reportPart(a, fresh)), "Electrical");
  }
  const mpnA = structuredClone(a), mpnB = structuredClone(b);
  mpnA.fields.MPN = "OLD";
  mpnB.fields.MPN = "NEW";
  const replacement = reportPart(mpnA, mpnB);
  assert.equal(propertyPriority(replacement.changes.find((c) => c.field === "fields"), replacement),
    "part identifier");
  assert.equal(changeGroup(replacement), "Electrical");
});

test("only explicitly flagged, unconnected fiducials are quiet additions and removals", () => {
  const fiducial = {
    footprint: "Fiducial:Fiducial_1mm",
    attributes: ["board_only", "exclude_from_bom"],
    pads: [{ number: "", net: "", type: "smd", shape: "circle" }],
  };
  for (const status of ["added", "removed"]) {
    const p = part([], { status, pads: fiducial.pads,
      before: status === "removed" ? fiducial : null,
      after: status === "added" ? fiducial : null });
    assert.equal(changeGroup(p), "Metadata");
    const mounting = { ...fiducial, footprint: "MountingHole:Hole_3mm" };
    p.before = status === "removed" ? mounting : null;
    p.after = status === "added" ? mounting : null;
    assert.equal(changeGroup(p), status === "added" ? "Added" : "Removed");
  }
  const connected = structuredClone(fiducial);
  connected.pads[0].net = "GND";
  assert.equal(changeGroup(part([], { status: "added", before: null, after: connected,
    pads: connected.pads })), "Added");
  assert.equal(changeGroup(part([{ field: "pads" }], { before: fiducial,
    after: fiducial, pads: fiducial.pads })), "Electrical");
});
test("electrical priority includes pin, pad, value and footprint edits but not zero-pad artwork", () => {
  for (const field of ["pins", "pads", "value", "footprint"])
    assert.equal(changeGroup(part([{ field }])), "Electrical");
  assert.equal(
    changeGroup(
      part([
        { field: "fields", before: {}, after: { Description: "Connector" } },
        { field: "x" },
      ]),
    ),
    "Metadata",
  );
  for (const status of ["added", "removed"]) {
    assert.ok(isElectrical(part([], { status })));
    assert.equal(changeGroup(part([], { status, pads: [] })), "Metadata");
  }
  assert.deepEqual(
    orderedChanges(
      part([{ field: "x" }, { field: "value" }, { field: "pins" }]),
    ).map((c) => c.field),
    ["pins", "value", "x"],
  );
});
test("changed numbered pads combine normalized geometry and pin-net changes", () => {
  const p = part([
    {
      field: "pins",
      before: { 1: ["GND"], 2: ["A"] },
      after: { 1: ["GND"], 2: ["B"] },
    },
    {
      field: "pads",
      before: [
        { number: "1", w: 1 },
        { number: "2", w: 1 },
        { number: "3", w: 1 },
      ],
      after: [
        { number: "1", w: 1 },
        { number: "2", w: 2 },
        { number: "3", w: 2 },
      ],
    },
  ]);
  assert.deepEqual(changedPins(p), ["2"]);
  assert.deepEqual([...changedPadNumbers(p)].sort(), ["2", "3"]);
  assert.equal(
    changedPadNumbers(
      part([
        { field: "fields", before: {}, after: { Description: "Connector" } },
      ]),
    ).size,
    0,
  );
  assert.deepEqual(
    [...changedPadNumbers(part([], { before: null }))],
    ["1", "2"],
  );
});

test("removing the last electrical pad remains an electrical change", () => {
  const p = part(
    [{ field: "pins" }, { field: "pads" }],
    { before: { pads: [{ number: "1" }] }, after: { pads: [] }, pads: [] },
  );
  assert.equal(changeGroup(p), "Electrical");
  assert.ok(isElectrical(p));
});

test("mechanical pad changes remain visible in the region highlight", () => {
  const p = part([
    {
      field: "pads",
      before: [{ number: "", drill: ["1"] }],
      after: [{ number: "", drill: ["1.4"] }],
    },
  ]);
  assert.ok(changedPadNumbers(p).has(""));
});

test("only changed mechanical pads highlight among multiple mounting holes", () => {
  const hole = (x, drill, angle = 0) => ({ number: "", x, drill: [drill], angle });
  const before = { angle: 0, pads: [hole(0, "1"), hole(5, "1")] };
  const after = { angle: 90, pads: [hole(5, "1", 90), hole(0, "1.4", 90)] };
  const p = { before, after };
  assert.deepEqual([...changedMechanicalPads(p, "before")], [before.pads[0]]);
  assert.deepEqual([...changedMechanicalPads(p, "after")], [after.pads[1]]);
  const added = { before: null, after };
  assert.equal(changedMechanicalPads(added, "after").size, 2);
  assert.equal(changedMechanicalPads(added, "before").size, 0);
});

test("population transitions and both-present part identifiers outrank descriptive fields", () => {
  for (const [before, after] of [
    [{ DNP: "DNP" }, { DNP: "" }],
    [{}, { DNP: "DNP" }],
    [{ DNP: "DNP" }, {}],
    [{ "Part Number": "ABC-1" }, { "Part Number": "ABC-2" }],
    [{ MPN: "M1" }, { MPN: "M2" }],
  ])
    assert.equal(
      changeGroup(part([{ field: "fields", before, after }])),
      "Electrical",
    );
  assert.equal(
    changeGroup(
      part([{ field: "attributes", before: ["smd"], after: ["smd", "dnp"] }]),
    ),
    "Electrical",
  );
  for (const [before, after] of [
    [{}, { MPN: "ABC" }],
    [{ Supplier: "A" }, { Supplier: "B" }],
    [{ DNP: "" }, {}],
    [{ Description: "A" }, { Description: "B" }],
  ])
    assert.equal(
      changeGroup(part([{ field: "fields", before, after }])),
      "Metadata",
    );
});

test("pad geometry reads as named properties and repeated pads share one description", () => {
  const paste = (x, y) => ({
    number: "", type: "smd", shape: "roundrect", x, y, angle: 0, w: 1.1, h: 1.1,
    drill: [], layers: ["F.Paste"], geometry: [["roundrect_rratio", "0.25"]],
  });
  assert.deepEqual(padFacts(paste(0, 0)), [
    ["Pad", "SMD roundrect"],
    ["Size", "1.1 × 1.1 mm"],
    ["Rotation", "0°"],
    ["Drill", "None"],
    ["Layers", "F.Paste"],
    ["Corner ratio", "0.25"],
  ]);
  const hole = {
    number: "1", type: "thru_hole", shape: "oval", x: 1, y: 2, angle: 90, w: 2, h: 3,
    drill: ["oval", "0.8", "1.2", ["offset", "0.1", "0"]], layers: ["*.Cu", "*.Mask"], geometry: [],
  };
  assert.deepEqual(padFacts(hole)[3], ["Drill", "oval 0.8 × 1.2 mm, offset 0.1, 0 mm"]);
  const bundles = padBundles([paste(-1, -1), paste(1, 1), hole, paste(1, -1)]);
  assert.equal(bundles.length, 2);
  assert.deepEqual(bundles[0].at, ["-1, -1", "1, 1", "1, -1"]);
  assert.deepEqual(bundles[1].at, ["1, 2"]);
  assert.deepEqual(padBundles(), []);
});

test("an edited pad does not mark its untouched neighbors as changed", () => {
  const pad = (x, w = 1) => ({
    number: "", type: "smd", shape: "rect", x, y: 0, angle: 0, w, h: 1,
    drill: [], layers: ["F.Cu"], geometry: [],
  });
  const other = { ...pad(9), layers: ["B.Cu"] };
  const before = padBundles([pad(0), pad(1), other]),
    after = padBundles([pad(0), pad(1, 2), other]);
  assert.equal(before.length, 2);
  assert.equal(after.length, 3);
  const pairs = pairBundles(after, before);
  assert.equal(pairs[0], before[0], "the unchanged group pairs with its original");
  assert.equal(pairs[2], before[1], "an unrelated group stays paired with itself");
  assert.equal(pairs[1], null, "the split-off pad has no counterpart");
  const reordered = pairBundles(padBundles([other, pad(0)]), padBundles([pad(0), other]));
  assert.deepEqual(reordered.map((bundle) => bundle.facts[4][1]), ["B.Cu", "F.Cu"]);
});

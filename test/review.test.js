import test from "node:test";
import assert from "node:assert/strict";
import {
  changeGroup,
  changedPins,
  changedPadNumbers,
  orderedChanges,
  isElectrical,
  changedMechanicalPads,
} from "../web/review.js";
const part = (changes = [], extra = {}) => ({
  status: "modified",
  pads: [{ number: "1" }, { number: "2" }],
  before: {},
  after: {},
  changes,
  ...extra,
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

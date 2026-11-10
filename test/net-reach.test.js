import test from "node:test";
import assert from "node:assert/strict";
import { reach } from "../src/compare.js";
import { rankedNetReach, netReachGroups } from "../web/review.js";
const net = (name, before, after = before, file = "board") => ({ name, before, after, file });
const owner = { id: "A", file: "board" };
test("per-net counts include peers already reached through another net", () => {
  const report = { nets: {
    signal: net("SIGNAL", ["A", "B"]),
    power: net("3V3", ["A", "B", "C"], ["A", "B", "C", "D"]),
    foreign: net("3V3", ["other-A", "other-X"], undefined, "other-board"),
  } };
  const result = reach(report, owner.id);
  assert.deepEqual(rankedNetReach(report, owner, result), [
    { name: "3V3", count: 3 }, { name: "SIGNAL", count: 1 },
  ]);
  assert.deepEqual(netReachGroups(report, owner, result), [
    { name: "3V3", ids: ["B", "C", "D"] }, { name: "SIGNAL", ids: ["B"] },
  ], "a peer appears in every net it shares, not just its first BFS edge");
});
test("a historical source cannot acquire new loads from a later revision", () => {
  const report = { nets: { power: net("3V3", ["A", "B"], ["C", "D"]) } };
  const result = reach(report, "A");
  assert.deepEqual(result.ids, ["B"]);
  assert.deepEqual(rankedNetReach(report, owner, result), [{ name: "3V3", count: 1 }]);
});
test("transitive counts describe reachable members on each included net", () => {
  const report = { nets: {
    signal: net("SIGNAL", ["A", "B"]),
    power: net("3V3", ["B", "C", "D"]),
    isolated: net("ISOLATED", ["X", "Y"]),
  } };
  const result = reach(report, "A", { transitive: true });
  assert.deepEqual(rankedNetReach(report, owner, result, true), [
    { name: "3V3", count: 3 }, { name: "SIGNAL", count: 1 },
  ]);
});

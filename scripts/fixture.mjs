import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/git.js";
// Small git history for browser regressions, independent of network or upstream history.
export function reviewFixture({ removedOnly = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "boardmap-browser-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  const part = (ref, value, x, extra = "") =>
    `(footprint "Connector" (layer "F.Cu") (at ${x} 30 45) (property "Reference" "${ref}") (property "Value" "${value}") (pad "1" thru_hole oval (at 15 15 45) (size 2 3) (drill oval 0.8 1.2) (net "VIN")) ${extra})`;
  const board = (head) =>
    `(kicad_pcb (version 20260206) ${part("U1", head ? "3V3 regulator" : "5V regulator", 10, `(property "ManufacturerPartNumber" "${head ? "REG-3V3" : "REG-5V"}") (pad "2" thru_hole circle (at -15 -15) (size 2 2) (drill ${head ? 1.2 : 0.8}) (net "GND")) (pad "" np_thru_hole circle (at 0 0) (size 2 2) (drill ${head ? 1.4 : 1})) (pad "" np_thru_hole circle (at 5 0) (size 2 2) (drill 1))`)} ${part("R1", "10k", 20)} ${part(head ? "C2" : "C1", "1uF", 30)})`;
  for (const head of [false, true]) {
    if (head && removedOnly)
      git(repo, [
        "rm",
        "--",
        ...Array.from({ length: 9 }, (_, i) => `board-${i}.kicad_pcb`),
      ]);
    else
      for (let i = 0; i < 9; i++)
        writeFileSync(join(repo, `board-${i}.kicad_pcb`), board(head));
    git(repo, ["add", "."]);
    git(repo, ["commit", "-qm", head ? "head" : "base"]);
  }
  return {
    repo,
    base: "HEAD~1",
    head: "HEAD",
    cleanup: () => rmSync(repo, { recursive: true, force: true }),
  };
}

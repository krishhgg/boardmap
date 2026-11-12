// Presentation priorities use the existing semantic diff, never raw net-name guesses.
export const fieldOrder = ["pins", "pads", "value", "footprint"];
const normalizedKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const dnp = (value) =>
  /^(?:1|yes|true|dnp|dnf|do[ _-]?not[ _-]?(?:populate|place)|not[ _-]?fitted)$/i.test(
    String(value ?? "").trim(),
  );
// Verified legacy library features migrated a custom DNP field into BOM metadata.
// Unknown footprints stay conservative. BOM exclusion never defines DNP state.
const legacyFeatures = new Set([
  "hackrf:GSG-HOLE126MIL-COPPER",
  "hackrf:GSG-TESTPOINT-50MIL",
  "gsg-modules:0603-JUMPER",
]);
export function legacyAssemblyMigration(part) {
  const a = part?.before,
    b = part?.after;
  if (!a || !b || a.footprint !== b.footprint || !legacyFeatures.has(a.footprint))
    return false;
  const attributesAre = (p, flags) =>
    p.attributes.length === flags.length &&
    flags.every((flag) => p.attributes.includes(flag));
  const direction = (old, fresh) =>
    attributesAre(old, ["exclude_from_pos_files"]) &&
    attributesAre(fresh, ["exclude_from_bom", "exclude_from_pos_files"]) &&
    old.fields.DNP === "DNP" &&
    !Object.hasOwn(old.fields, "exclude_from_bom") &&
    (fresh.fields.DNP === "" || !Object.hasOwn(fresh.fields, "DNP")) &&
    fresh.fields.exclude_from_bom === "";
  return direction(a, b) || direction(b, a);
}
export function propertyReasons(change, part) {
  if (change.field === "attributes")
    return change.before.includes("dnp") !== change.after.includes("dnp")
      ? ["population"]
      : [];
  if (change.field !== "fields") return [];
  const reasons = [];
  const keys = new Set([
    ...Object.keys(change.before),
    ...Object.keys(change.after),
  ]);
  for (const key of keys)
    if (
      ["dnp", "donotpopulate", "donotplace"].includes(normalizedKey(key)) &&
      dnp(change.before[key]) !== dnp(change.after[key]) &&
      !(key === "DNP" && legacyAssemblyMigration(part))
    ) {
      reasons.push("population");
      break;
    }
  for (const key of keys) {
    if (
      ![
        "mpn",
        "partnumber",
        "manufacturerpartnumber",
        "mfrpartnumber",
      ].includes(normalizedKey(key))
    )
      continue;
    const before = String(change.before[key] ?? "").trim(),
      after = String(change.after[key] ?? "").trim();
    if (before && after && before !== after) {
      reasons.push("part identifier");
      break;
    }
  }
  return reasons;
}
export const propertyPriority = (change, part) =>
  propertyReasons(change, part)[0] ?? null;
export const orderedChanges = (part) =>
  [...part.changes].sort((a, b) => {
    const rank = (change) =>
      fieldOrder.includes(change.field)
        ? fieldOrder.indexOf(change.field)
        : propertyPriority(change, part)
          ? 4
          : 5;
    return rank(a) - rank(b);
  });
export function changedPins(part) {
  const change = part.changes.find((c) => c.field === "pins");
  if (!change) return [];
  return [
    ...new Set([...Object.keys(change.before), ...Object.keys(change.after)]),
  ].filter(
    (pin) =>
      JSON.stringify(change.before[pin]) !== JSON.stringify(change.after[pin]),
  );
}
export function changeGroup(part) {
  if (part.status === "unchanged") return "Unchanged";
  if (!(part.before?.pads?.length || part.after?.pads?.length || part.pads.length))
    return "Metadata";
  if (
    ["added", "removed"].includes(part.status) &&
    isFiducial(part.after ?? part.before)
  )
    return "Metadata";
  if (part.status === "removed") return "Removed";
  if (part.status === "added") return "Added";
  return part.changes.some(
    (c) => fieldOrder.includes(c.field) || propertyPriority(c, part),
  )
    ? "Electrical"
    : "Metadata";
}
function isFiducial(p) {
  return (
    p &&
    /(?:^|[:_-])(?:fiducial|mark)(?:[_-]|\d|$)/i.test(p.footprint ?? "") &&
    p.attributes?.includes("board_only") &&
    p.attributes.includes("exclude_from_bom") &&
    p.pads.length > 0 &&
    p.pads.every((pad) =>
      !pad.number && !pad.net && pad.type === "smd" && pad.shape === "circle",
    )
  );
}
export const isElectrical = (part) =>
  ["Electrical", "Removed", "Added"].includes(changeGroup(part));
export function padGroups(pads) {
  const groups = new Map();
  for (const pad of pads) {
    if (!groups.has(pad.number)) groups.set(pad.number, []);
    groups.get(pad.number).push(pad);
  }
  return groups;
}
export function changedPadNumbers(part) {
  if (!part.before || !part.after)
    return new Set(part.pads.map((p) => p.number));
  const numbers = new Set(changedPins(part));
  const geometry = part.changes.find((c) => c.field === "pads");
  if (geometry) {
    const a = padGroups(geometry.before),
      b = padGroups(geometry.after);
    for (const number of new Set([...a.keys(), ...b.keys()]))
      if (JSON.stringify(a.get(number)) !== JSON.stringify(b.get(number)))
        numbers.add(number);
  }
  return numbers;
}

// Mechanical pads have no pin number. Match unchanged geometry as a multiset.
export function changedMechanicalPads(part, key) {
  const revision = part[key];
  if (!revision) return new Set();
  const pads = revision.pads.filter((pad) => !pad.number);
  const other = part[key === "before" ? "after" : "before"];
  if (!other) return new Set(pads);
  const signature = (pad, owner) => {
    const angle = (pad.angle ?? 0) - (owner.angle ?? 0);
    return JSON.stringify(
      Object.fromEntries(
        Object.entries({
          ...pad,
          angle: Number(((((angle % 360) + 360) % 360)).toFixed(6)),
        })
          .filter(([field]) => field !== "net")
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  };
  const remaining = other.pads
    .filter((pad) => !pad.number)
    .map((pad) => signature(pad, other));
  return new Set(
    pads.filter((pad) => {
      const index = remaining.indexOf(signature(pad, revision));
      if (index < 0) return true;
      remaining.splice(index, 1);
      return false;
    }),
  );
}

// Count every reachable peer on each net, not only the first edge that found it.
export function netReachGroups(report, part, result, transitive = false) {
  const reached = new Set([part.id, ...result.ids]);
  const included = new Set(result.nets);
  return Object.values(report.nets)
    .filter((net) => net.file === part.file && included.has(net.name))
    .map((net) => {
      const peers = new Set();
      for (const members of [net.before, net.after]) {
        const connected = transitive
          ? members.some((id) => reached.has(id))
          : members.includes(part.id);
        if (!connected) continue;
        for (const id of members)
          if (id !== part.id && reached.has(id)) peers.add(id);
      }
      return {
        name: net.name,
        ids: [...peers].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        ),
      };
    })
    .sort((a, b) =>
      b.ids.length - a.ids.length ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
}
export const rankedNetReach = (report, part, result, transitive = false) =>
  netReachGroups(report, part, result, transitive).map(({ name, ids }) => ({
    name,
    count: ids.length,
  }));

// Named pad properties in reading order, with units.
export function padFacts(pad) {
  const kind =
    { smd: "SMD", thru_hole: "Through-hole", np_thru_hole: "Unplated hole", connect: "Edge connector" }[
      pad.type
    ] ?? pad.type;
  const drill = pad.drill ?? [];
  const oval = drill[0] === "oval";
  const offset = drill.find((n) => Array.isArray(n) && n[0] === "offset");
  const hole = !drill.length
    ? "None"
    : `${oval ? `oval ${drill[1]} × ${drill[2]}` : drill[0]} mm${offset ? `, offset ${offset[1]}, ${offset[2]} mm` : ""}`;
  return [
    ["Pad", `${kind} ${pad.shape}`],
    ["Size", `${pad.w} × ${pad.h} mm`],
    ["Rotation", `${pad.angle}°`],
    ["Drill", hole],
    ["Layers", pad.layers.join(", ")],
    ...pad.geometry.map((entry) =>
      entry[0] === "roundrect_rratio"
        ? ["Corner ratio", String(entry[1])]
        : [String(entry[0]), JSON.stringify(entry.slice(1))],
    ),
  ];
}
// Pads that differ only in position share one description and list their positions.
export function padBundles(pads = []) {
  const bundles = new Map();
  for (const pad of pads) {
    const facts = padFacts(pad),
      key = JSON.stringify(facts);
    if (!bundles.has(key)) bundles.set(key, { facts, at: [] });
    bundles.get(key).at.push(`${pad.x}, ${pad.y}`);
  }
  return [...bundles.values()];
}

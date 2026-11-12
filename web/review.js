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

// Pair each bundle with its counterpart in the other revision. Identical descriptions pair
// first, so an untouched group stays neutral when a neighbor splits. The rest pair in order.
export function pairBundles(mine, theirs) {
  const free = [...theirs],
    pairs = new Array(mine.length).fill(null);
  mine.forEach((bundle, index) => {
    const at = free.findIndex(
      (other) => JSON.stringify(other.facts) === JSON.stringify(bundle.facts),
    );
    if (at >= 0) pairs[index] = free.splice(at, 1)[0];
  });
  mine.forEach((_, index) => {
    if (!pairs[index] && free.length) pairs[index] = free.shift();
  });
  return pairs;
}

// A footprint's reach around its origin, in board millimeters, from its pads.
export function footprintExtent(part) {
  const turn = ((part.angle ?? 0) * Math.PI) / 180;
  let minX = -0.5,
    maxX = 0.5,
    minY = -0.5,
    maxY = 0.5;
  for (const [index, pad] of (part.pads ?? []).entries()) {
    const x = pad.x * Math.cos(turn) + pad.y * Math.sin(turn),
      y = -pad.x * Math.sin(turn) + pad.y * Math.cos(turn),
      spin = ((pad.angle ?? 0) * Math.PI) / 180,
      rx = (Math.abs(pad.w * Math.cos(spin)) + Math.abs(pad.h * Math.sin(spin))) / 2,
      ry = (Math.abs(pad.w * Math.sin(spin)) + Math.abs(pad.h * Math.cos(spin))) / 2;
    if (!index) [minX, maxX, minY, maxY] = [x - rx, x + rx, y - ry, y + ry];
    minX = Math.min(minX, x - rx);
    maxX = Math.max(maxX, x + rx);
    minY = Math.min(minY, y - ry);
    maxY = Math.max(maxY, y + ry);
  }
  return { minX, maxX, minY, maxY };
}

// Parts connected to this one in only one revision. Kept connections appear in neither list.
export function changedLinks(
  report,
  id,
  { transitive = false, includeGround = false } = {},
) {
  const reached = (key) => {
    const byPart = new Map();
    for (const net of Object.values(report.nets)) {
      if (!includeGround && net.ground) continue;
      for (const member of net[key]) {
        if (!byPart.has(member)) byPart.set(member, []);
        byPart.get(member).push(net[key]);
      }
    }
    const seen = new Set([id]),
      queue = [id],
      walked = new Set();
    for (let i = 0; i < queue.length; i++) {
      for (const members of byPart.get(queue[i]) ?? []) {
        // Expand each net once, however many of its members are queued.
        if (walked.has(members)) continue;
        walked.add(members);
        for (const target of members) {
          if (seen.has(target)) continue;
          seen.add(target);
          if (transitive) queue.push(target);
        }
      }
      if (!transitive) break;
    }
    seen.delete(id);
    return seen;
  };
  const before = reached("before"),
    after = reached("after");
  return {
    gained: [...after].filter((part) => !before.has(part)),
    lost: [...before].filter((part) => !after.has(part)),
  };
}

// Nudge overlapping boxes apart along the line between their centers. Each box moves at
// most `limit` from where it started, so a marker stays beside the part it stands for,
// and stays inside `bounds` when they are given.
export function spread(
  rects,
  // A board with hundreds of small changes gets fewer passes, which keeps a redraw quick.
  { gap = 2, limit = 18, rounds = rects.length > 600 ? 24 : 120, bounds, fixed = [] } = {},
) {
  // Fixed boxes push the others away and never move themselves.
  const movable = rects.length;
  rects = [...rects, ...fixed.map((r) => ({ ...r }))];
  const home = rects.map((r) => ({ x: r.x, y: r.y }));
  const order = rects.map((_, index) => index);
  for (let round = 0; round < rounds; round++) {
    const before = rects.map((r) => r.x + r.y);
    // Only boxes close along x can overlap, so a sweep in x order skips the rest.
    order.sort((a, b) => rects[a].x - rects[b].x);
    for (let m = 0; m < order.length; m++) {
      const i = order[m],
        a = rects[i];
      for (let n = m + 1; n < order.length; n++) {
        const j = order[n],
          b = rects[j];
        if (b.x >= a.x + a.w + gap) break;
        if (i >= movable && j >= movable) continue;
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap,
          dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
        if (dx <= 0.01 || dy <= 0.01) continue;
        let ux = b.x + b.w / 2 - (a.x + a.w / 2),
          uy = b.y + b.h / 2 - (a.y + a.h / 2);
        const length = Math.hypot(ux, uy);
        if (length < 0.01) {
          // Boxes that share a center leave in a direction fixed by their order.
          const angle = (i + j) * 2.399963;
          ux = Math.cos(angle);
          uy = Math.sin(angle);
        } else {
          ux /= length;
          uy /= length;
        }
        // The shortest slide along that line that clears one axis.
        const need = Math.min(
          Math.abs(ux) > 0.01 ? dx / Math.abs(ux) : Infinity,
          Math.abs(uy) > 0.01 ? dy / Math.abs(uy) : Infinity,
        );
        // A fixed box yields nothing, so the other one covers the whole distance.
        const aShare = i >= movable ? 0 : j >= movable ? 1 : 0.5;
        a.x -= ux * need * aShare;
        a.y -= uy * need * aShare;
        b.x += ux * need * (1 - aShare);
        b.y += uy * need * (1 - aShare);
      }
    }
    let shift = 0;
    rects.forEach((r, i) => {
      if (i >= movable) return;
      r.x = Math.max(home[i].x - limit, Math.min(home[i].x + limit, r.x));
      r.y = Math.max(home[i].y - limit, Math.min(home[i].y + limit, r.y));
      if (bounds) {
        r.x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - r.w, r.x));
        r.y = Math.max(bounds.y, Math.min(bounds.y + bounds.h - r.h, r.y));
      }
      shift = Math.max(shift, Math.abs(r.x + r.y - before[i]));
    });
    // Settled, or a cluster too dense to move farther. Either way another round changes nothing.
    if (shift < 0.05) break;
  }
  return rects.slice(0, movable);
}

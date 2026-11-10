const sheetPath = (part) => part.path.split("/").slice(0, -1).join("/");
export const sameSheet = (a, b) =>
  Boolean(a.path && b.path && sheetPath(a) === sheetPath(b));
const prefix = (name) => `/${name.replace(/^\/+|\/+$/g, "")}/`;

// A stable sheet UUID proves a label rename, rather than a move between sheets.
// Ambiguous labels are deliberately left alone when rewriting net prefixes.
export function sheetRenames(before, after) {
  const renamed = new Map(),
    candidates = new Map();
  for (const [id, a] of before) {
    const b = after.get(id);
    if (!b || a.sheet === b.sheet || !sameSheet(a, b)) continue;
    renamed.set(`${a.file}::${sheetPath(a)}`, {
      file: a.file,
      path: sheetPath(a),
      before: a.sheet,
      after: b.sheet,
    });
  }
  // Include unchanged labels so a rename can't rewrite another sheet with that label.
  for (const [id, a] of before) {
    const b = after.get(id);
    const key = `${a.file}::${prefix(a.sheet)}`;
    if (!candidates.has(key)) candidates.set(key, new Set());
    const proven = a.path
      ? renamed.get(`${a.file}::${sheetPath(a)}`)
      : undefined;
    const target =
      b && sameSheet(a, b)
        ? b.sheet
        : !b && proven?.before === a.sheet
          ? proven.after
          : a.sheet;
    candidates.get(key).add(prefix(target));
  }
  const rules = [];
  for (const [key, targets] of candidates) {
    const cut = key.lastIndexOf("::"),
      file = key.slice(0, cut),
      from = key.slice(cut + 2);
    const to = targets.size === 1 ? [...targets][0] : from;
    rules.push({ file, from, to: from === "//" || to === "//" ? from : to });
  }
  // Identity and ambiguous rules guard their prefixes from broader renames.
  rules.sort((a, b) => b.from.length - a.from.length);
  const blocked = new Set();
  const rewrite = (file, name) => {
    const rule = rules.find((r) => r.file === file && name.startsWith(r.from));
    return rule && !blocked.has(rule)
      ? { name: rule.to + name.slice(rule.from.length), rule }
      : { name, rule: null };
  };
  // A rename must not collapse two distinct historical nets. Blocking a rule can
  // expose another collision in a rename chain, so repeat until no rule changes.
  let changed;
  do {
    changed = false;
    const destinations = new Map();
    for (const part of before.values())
      for (const raw of new Set(
        Object.values(part.pins).flat().filter(Boolean),
      )) {
        const result = rewrite(part.file, raw),
          key = `${part.file}::${result.name}`,
          prior = destinations.get(key);
        if (prior && prior.raw !== raw) {
          for (const rule of [prior.rule, result.rule]) {
            if (rule && rule.from !== rule.to && !blocked.has(rule)) {
              blocked.add(rule);
              changed = true;
            }
          }
        } else destinations.set(key, { raw, rule: result.rule });
      }
  } while (changed);
  return {
    renames: [...renamed.values()],
    netName: (file, name) => rewrite(file, name).name,
  };
}
// Only a unique, complete pin-for-pin match proves a standalone label rename.
// Added and removed components participate, so changing a net's loads never matches.
export function netLabelRenames(before, after, sheetName) {
  const index = (parts, nameOf) => {
    const files = new Map();
    for (const part of parts.values()) {
      if (!files.has(part.file)) files.set(part.file, new Map());
      const nets = files.get(part.file);
      for (const [pin, names] of Object.entries(part.pins))
        for (const raw of names.filter(Boolean)) {
          const name = nameOf(part.file, raw);
          if (!nets.has(name)) nets.set(name, { raw, members: new Set() });
          nets.get(name).members.add(JSON.stringify([part.id, pin]));
        }
    }
    return files;
  };
  const old = index(before, sheetName),
    fresh = index(after, (_, name) => name),
    mappings = new Map(),
    renames = [];
  const candidates = (nets, other) => {
    const signatures = new Map();
    for (const [name, entry] of nets) {
      if (other.has(name)) continue;
      const signature = JSON.stringify([...entry.members].sort());
      if (!signatures.has(signature)) signatures.set(signature, []);
      signatures.get(signature).push({ name, raw: entry.raw });
    }
    return signatures;
  };
  for (const [file, oldNets] of old) {
    const newNets = fresh.get(file) ?? new Map(),
      oldCandidates = candidates(oldNets, newNets),
      newCandidates = candidates(newNets, oldNets),
      names = new Map();
    for (const [signature, sources] of oldCandidates) {
      const targets = newCandidates.get(signature);
      if (sources.length !== 1 || targets?.length !== 1) continue;
      names.set(sources[0].name, targets[0].name);
      renames.push({ file, before: sources[0].raw, after: targets[0].name });
    }
    mappings.set(file, names);
  }
  return {
    renames,
    netName: (file, raw) => {
      const name = sheetName(file, raw);
      return mappings.get(file)?.get(name) ?? name;
    },
  };
}
export function padGeometry(part) {
  return part.pads
    .map(({ net, ...pad }) => ({
      ...pad,
      angle: Number(
        ((((pad.angle - part.angle) % 360) + 360) % 360).toFixed(6),
      ),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

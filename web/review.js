// Presentation priorities use the existing semantic diff, never raw net-name guesses.
export const fieldOrder = ["pins", "pads", "value", "footprint"];
const normalizedKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const dnp = (value) =>
  /^(?:1|yes|true|dnp|dnf|do[ _-]?not[ _-]?(?:populate|place)|not[ _-]?fitted)$/i.test(
    String(value ?? "").trim(),
  );
export function propertyPriority(change) {
  if (change.field === "attributes")
    return change.before.includes("dnp") !== change.after.includes("dnp")
      ? "population"
      : null;
  if (change.field !== "fields") return null;
  const keys = new Set([
    ...Object.keys(change.before),
    ...Object.keys(change.after),
  ]);
  for (const key of keys)
    if (
      ["dnp", "donotpopulate", "donotplace"].includes(normalizedKey(key)) &&
      dnp(change.before[key]) !== dnp(change.after[key])
    )
      return "population";
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
    if (before && after && before !== after) return "part identifier";
  }
  return null;
}
export const orderedChanges = (part) =>
  [...part.changes].sort((a, b) => {
    const rank = (change) =>
      fieldOrder.includes(change.field)
        ? fieldOrder.indexOf(change.field)
        : propertyPriority(change)
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
  if (part.status === "removed") return "Removed";
  if (part.status === "added") return "Added";
  return part.changes.some(
    (c) => fieldOrder.includes(c.field) || propertyPriority(c),
  )
    ? "Electrical"
    : "Metadata";
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

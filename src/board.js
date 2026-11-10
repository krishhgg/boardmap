import {parse, children, child, atom} from './sexpr.js';

export function readBoard(text, file) {
  const tree = parse(text);
  if (tree[0] !== 'kicad_pcb') throw new Error(`${file}: not a KiCad board`);
  const netNames = new Map(children(tree, 'net').map(n => [n[1], n[2]]));
  const parts = [];
  for (const fp of [...children(tree, 'footprint'), ...children(tree, 'module')]) {
    const props = Object.fromEntries(children(fp, 'property').map(p => [p[1], p[2]]));
    const ref = props.Reference ?? children(fp, 'fp_text').find(p => p[1] === 'reference')?.[2] ?? '';
    if (!ref || ref === 'REF**') continue;
    const at = child(fp, 'at') ?? [];
    const pads = children(fp, 'pad').map(p => {
      const pos = child(p, 'at') ?? [], size = child(p, 'size') ?? [], net = child(p, 'net');
      return {number: p[1], type: p[2], shape: p[3], x: Number(pos[1] ?? 0), y: Number(pos[2] ?? 0),
        angle: Number(pos[3] ?? 0), w: Number(size[1] ?? 1), h: Number(size[2] ?? 1),
        net: net?.[2] ?? netNames.get(net?.[1]) ?? '',
        drill: child(p,'drill')?.slice(1) ?? [], layers: child(p,'layers')?.slice(1).sort() ?? []};
    });
    const pins = {};
    for (const pad of pads) {
      if (!pad.number) continue;
      (pins[pad.number] ??= []);
      if (!pins[pad.number].includes(pad.net)) pins[pad.number].push(pad.net);
    }
    for (const nets of Object.values(pins)) nets.sort();
    const fields = Object.fromEntries(Object.entries(props).filter(([k]) => !['Reference','Value','Footprint','Sheetfile','Sheetname'].includes(k)).sort());
    parts.push({id: `${file}::${ref}`, ref, file,
      sheet: props.Sheetname || '/', value: props.Value ?? children(fp, 'fp_text').find(p => p[1] === 'value')?.[2] ?? '',
      footprint: fp[1], fields, pins, pads, x: Number(at[1] ?? 0), y: Number(at[2] ?? 0), angle: Number(at[3] ?? 0),
      side: atom(fp,'layer'), uuid: atom(fp,'uuid',atom(fp,'tstamp')), path: atom(fp,'path')});
  }
  const counts = new Map();
  for (const part of parts) counts.set(part.ref, (counts.get(part.ref) ?? 0) + 1);
  const seen = new Set();
  for (const part of parts) {
    if (counts.get(part.ref) > 1) part.id += `::${part.uuid || part.path}`;
    if (seen.has(part.id)) throw new Error(`${file}: duplicate reference ${part.ref} has no unique UUID`);
    seen.add(part.id);
  }
  return parts;
}

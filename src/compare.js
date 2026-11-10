const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const stable = object => Object.fromEntries(Object.entries(object).sort(([a],[b]) => a.localeCompare(b)));
const ground = name => /^(GND|GNDA|GNDD|AGND|DGND|PGND|Earth|Chassis)$/i.test(name.split('/').at(-1));
export {ground};
export function compare(before, after, metadata = {}) {
  const duplicates = new Set();
  for (const parts of [before,after]) {
    const seen = new Set();
    for (const p of parts) { const key = `${p.file}::${p.ref}`; if (seen.has(key)) duplicates.add(key); seen.add(key); }
  }
  const normalize = parts => parts.map(p => ({...p,
    id: `${p.file}::${p.ref}${duplicates.has(`${p.file}::${p.ref}`) ? `::${p.uuid || p.path}` : ''}`,
    pads: [...p.pads].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }));
  before = normalize(before); after = normalize(after);
  const old = new Map(before.map(p => [p.id,p])), fresh = new Map(after.map(p => [p.id,p]));
  const parts = [...new Set([...old.keys(),...fresh.keys()])].sort().map(id => {
    const a = old.get(id), b = fresh.get(id), changes = [];
    if (a && b) {
      for (const key of ['value','footprint','side','sheet','x','y','angle','attributes','fields','pins']) {
        const av = key === 'pins' ? stable(a[key]) : a[key], bv = key === 'pins' ? stable(b[key]) : b[key];
        if (!equal(av,bv)) changes.push({field:key,before:a[key],after:b[key]});
      }
      // Changes to pad geometry matter even when the footprint library name stays the same.
      const geometry = pads => pads.map(({net,...pad})=>pad).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
      const ag = geometry(a.pads), bg = geometry(b.pads);
      if (!equal(ag,bg)) changes.push({field:'pads',before:ag,after:bg});
    }
    return {...(b ?? a), before:a ?? null, after:b ?? null, changes,
      status:!a?'added':!b?'removed':changes.length?'modified':'unchanged'};
  });
  const nets = {};
  for (const part of parts) {
    for (const [revision,state] of [['before',part.before],['after',part.after]]) {
      if (!state) continue;
      for (const name of new Set(Object.values(state.pins).flat().filter(Boolean))) {
        const key = `${part.file}::${name}`;
        if (!Object.hasOwn(nets,key)) nets[key] = {name,file:part.file,ground:ground(name),before:[],after:[]};
        const list = nets[key][revision];
        if (!list.includes(part.id)) list.push(part.id);
      }
    }
  }
  for (const net of Object.values(nets)) {
    net.before.sort(); net.after.sort();
    net.status = !net.before.length?'added':!net.after.length?'removed':equal(net.before,net.after)?'unchanged':'modified';
  }
  const report = {schema:1,...metadata, parts,nets};
  const changed = parts.filter(p => p.status !== 'unchanged');
  const changedIds = new Set(changed.map(p=>p.id)), affected = new Set();
  for (const net of Object.values(nets)) {
    if (net.ground) continue;
    const members = [...new Set([...net.before,...net.after])];
    if (members.some(id=>changedIds.has(id))) for (const id of members) affected.add(id);
  }
  for (const p of changed) affected.delete(p.id);
  report.stats = {parts:after.length, removed:parts.filter(p=>p.status==='removed').length,
    nets:Object.values(nets).filter(n=>n.after.length).length,
    sheets:new Set(parts.map(p=>`${p.file}::${p.sheet}`)).size, changed:changed.length, affected:affected.size};
  return report;
}

// A graph over both revisions preserves the impact of removed connections.
// Transitive reach is structural adjacency through components, not signal simulation.
export function reach(report, id, {transitive = false, includeGround = false} = {}) {
  const links = new Map(), byPart = new Map();
  for (const [key,net] of Object.entries(report.nets)) {
    if (!includeGround && net.ground) continue;
    const members = [...new Set([...net.before,...net.after])];
    links.set(key,members);
    for (const member of members) {
      if (!byPart.has(member)) byPart.set(member,[]);
      byPart.get(member).push(key);
    }
  }
  const seen = new Set([id]), queue = [id], edges = [], usedNets = new Set();
  for (let i=0;i<queue.length;i++) {
    const source = queue[i];
    for (const key of byPart.get(source) ?? []) {
      if (usedNets.has(key)) continue;
      usedNets.add(key);
      for (const target of links.get(key)) {
        if (seen.has(target)) continue;
        seen.add(target); edges.push({source,target,net:report.nets[key].name});
        if (transitive) queue.push(target);
      }
    }
    if (!transitive) break;
  }
  seen.delete(id);
  return {ids:[...seen],edges,nets:[...usedNets].map(k=>report.nets[k].name)};
}

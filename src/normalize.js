const sheetPath = part => part.path.split('/').slice(0,-1).join('/');
export const sameSheet = (a,b) => Boolean(a.path && b.path && sheetPath(a) === sheetPath(b));
const prefix = name => `/${name.replace(/^\/+|\/+$/g,'')}/`;

// A stable sheet UUID proves a label rename, rather than a move between sheets.
// Ambiguous labels are deliberately left alone when rewriting net prefixes.
export function sheetRenames(before,after) {
  const renamed=new Map(), candidates=new Map();
  for (const [id,a] of before) {
    const b=after.get(id);
    if (!b || a.sheet===b.sheet || !sameSheet(a,b)) continue;
    renamed.set(`${a.file}::${sheetPath(a)}`,{file:a.file,path:sheetPath(a),before:a.sheet,after:b.sheet});
  }
  // Include unchanged labels so a rename can't rewrite another sheet with that label.
  for (const [id,a] of before) {
    const b=after.get(id);
    const key=`${a.file}::${prefix(a.sheet)}`;
    if(!candidates.has(key)) candidates.set(key,new Set());
    candidates.get(key).add(prefix(b && sameSheet(a,b)?b.sheet:a.sheet));
  }
  const rules=[];
  for(const [key,targets] of candidates) {
    const cut=key.lastIndexOf('::'),file=key.slice(0,cut),from=key.slice(cut+2);
    const to=targets.size===1?[...targets][0]:from;
    rules.push({file,from,to:from==='//' || to==='//'?from:to});
  }
  // Identity and ambiguous rules guard their prefixes from broader renames.
  rules.sort((a,b)=>b.from.length-a.from.length);
  const blocked=new Set();
  const rewrite=(file,name)=> {
    const rule=rules.find(r=>r.file===file && name.startsWith(r.from));
    return rule && !blocked.has(rule)?{name:rule.to+name.slice(rule.from.length),rule}:{name,rule:null};
  };
  // A rename must not collapse two distinct historical nets. Blocking a rule can
  // expose another collision in a rename chain, so repeat until no rule changes.
  let changed;
  do {
    changed=false;
    const destinations=new Map();
    for(const part of before.values()) for(const raw of new Set(Object.values(part.pins).flat().filter(Boolean))) {
      const result=rewrite(part.file,raw),key=`${part.file}::${result.name}`,prior=destinations.get(key);
      if(prior && prior.raw!==raw) {
        for(const rule of [prior.rule,result.rule]) {
          if(rule && rule.from!==rule.to && !blocked.has(rule)){blocked.add(rule);changed=true;}
        }
      } else destinations.set(key,{raw,rule:result.rule});
    }
  } while(changed);
  return {renames:[...renamed.values()],netName:(file,name)=>rewrite(file,name).name};
}
export function padGeometry(part) {
  return part.pads.map(({net,...pad})=>({...pad,angle:Number((((pad.angle-part.angle)%360+360)%360).toFixed(6))}))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

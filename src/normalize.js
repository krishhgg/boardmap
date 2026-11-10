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
    const b=after.get(id);if(!b || !sameSheet(a,b)) continue;
    const key=`${a.file}::${prefix(a.sheet)}`;
    if(!candidates.has(key)) candidates.set(key,new Set());
    candidates.get(key).add(prefix(b.sheet));
  }
  const mappings=[];
  for(const [key,targets] of candidates) {
    const cut=key.lastIndexOf('::'),file=key.slice(0,cut),from=key.slice(cut+2);
    if(targets.size===1 && from!=='//') {
      const to=[...targets][0];if(to!==from && to!=='//')mappings.push({file,from,to});
    }
  }
  mappings.sort((a,b)=>b.from.length-a.from.length);
  return {renames:[...renamed.values()],netName:(file,name)=> {
    const match=mappings.find(m=>m.file===file && name.startsWith(m.from));
    return match?match.to+name.slice(match.from.length):name;
  }};
}
export function padGeometry(part) {
  return part.pads.map(({net,...pad})=>({...pad,angle:Number((((pad.angle-part.angle)%360+360)%360).toFixed(6))}))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

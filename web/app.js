import {reach} from '/compare.js';
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg',tag); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,v); return n; };
const state = {scope:null, view:'map', selected:null, hover:null, query:'', transitive:false, includeGround:false};
let report, parts, resize, mapSize='';
const weight = p => Math.max(3,Object.keys(p.pins).length);
const shortFile = file => file.split('/').at(-1).replace('.kicad_pcb','');
const mark = p => ({modified:'~',added:'+',removed:'−',unchanged:'·'})[p.status];
function matches(p) {
  return `${p.ref} ${p.value} ${p.footprint} ${Object.values(p.before?.pins ?? {}).flat().join(' ')} ${Object.values(p.after?.pins ?? {}).flat().join(' ')}`.toLowerCase().includes(state.query);
}
function inScope(p) { return !state.scope || (p.file===state.scope.file && (!state.scope.sheet || p.sheet===state.scope.sheet)); }
function breadcrumb() {
  const nav = $('breadcrumbs'); nav.replaceChildren();
  const home = el('button','⌂ Whole design'); home.onclick=()=>setScope(null); nav.append(home);
  if (state.scope) {
    nav.append(el('span','/'));
    const board = el('button',shortFile(state.scope.file)); board.onclick=()=>setScope({file:state.scope.file}); nav.append(board);
    if (state.scope.sheet) { nav.append(el('span','/')); nav.append(el('span',state.scope.sheet)); }
  }
}
function setScope(scope) { state.scope=scope; state.selected=null; $('diff-panel').hidden=true; $('map-panel').hidden=false; breadcrumb(); renderMap(); resetImpact(); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $('tiles').animate([{opacity:.4,transform:'scale(.98)'},{opacity:1,transform:'scale(1)'}],{duration:180,easing:'ease-out'}); }
function renderList() {
  const list=$('part-list'); list.replaceChildren();
  const shown = report.parts.filter(p=>matches(p) && (!$('only-changed').checked || p.status!=='unchanged'));
  $('list-count').textContent=`${shown.length} shown`;
  for (const p of shown) {
    const row=el('button',undefined,`part-row ${p.status}`); row.dataset.id=p.id;
    row.setAttribute('aria-label',`${p.ref}, ${p.value}, ${p.status}, ${shortFile(p.file)}`);
    row.append(el('span',mark(p),'status-mark'));
    const meta=el('span',undefined,'part-meta'); meta.append(el('strong',p.ref),el('small',`${p.value || p.footprint} · ${shortFile(p.file)}`));
    row.append(meta,el('span',p.status==='modified'?`${p.changes.length} Δ`:mark(p),'change-fields'));
    wirePart(row,p); list.append(row);
  }
  if (!shown.length) list.append(el('p','No components match. Clear the search or include unchanged parts.','empty'));
}
function wirePart(node,p) {
  node.onmouseenter=()=>highlight(p.id); node.onmouseleave=resetImpact;
  node.onfocus=()=>highlight(p.id); node.onblur=resetImpact;
  node.onclick=()=>openDiff(p);
}
// Balanced binary treemap. Split by cumulative pad count along the longer axis.
function pack(items,rect,visit,minSize=0) {
  if (!items.length) return;
  if (items.length===1) { visit(items[0],rect); return; }
  const total=items.reduce((s,p)=>s+p.weight,0); let sum=0,cut=0;
  while (cut<items.length-1 && (sum===0 || sum+items[cut].weight<=total/2)) sum+=items[cut++].weight;
  const axis=rect.w>=rect.h?rect.w:rect.h;
  const floor=Math.min(minSize,axis/2);
  const ratio=Math.max(floor/axis,Math.min(1-floor/axis,sum/total));
  if (rect.w>=rect.h) {
    pack(items.slice(0,cut),{...rect,w:rect.w*ratio},visit,minSize);
    pack(items.slice(cut),{...rect,x:rect.x+rect.w*ratio,w:rect.w*(1-ratio)},visit,minSize);
  } else {
    pack(items.slice(0,cut),{...rect,h:rect.h*ratio},visit,minSize);
    pack(items.slice(cut),{...rect,y:rect.y+rect.h*ratio,h:rect.h*(1-ratio)},visit,minSize);
  }
}
function position(node,r,gap=2) { Object.assign(node.style,{left:`${r.x+gap}px`,top:`${r.y+gap}px`,width:`${Math.max(1,r.w-gap*2)}px`,height:`${Math.max(1,r.h-gap*2)}px`}); }
function tile(p,r,parent) {
  const node=el('button',undefined,`tile ${p.status}`); node.dataset.id=p.id; position(node,r);
  node.setAttribute('aria-label',`${p.ref}, ${p.value}, ${p.status}`);
  node.title=`${p.ref} · ${p.value}\n${p.status} · ${Object.keys(p.pins).length} numbered pads\n${p.sheet}`;
  if (r.w>22 && r.h>17) {
    const label=el('span',p.ref,'ref'); label.style.fontSize=`${Math.max(7,Math.min(12,(r.w-13)/(p.ref.length*.65)))}px`; node.append(label);
  }
  if (r.w>45 && r.h>40) node.append(el('span',p.value || p.footprint,'value'));
  if (r.w>55 && r.h>65) node.append(el('span',`${Object.keys(p.pins).length} pads`,'pin-count'));
  wirePart(node,p); parent.append(node);
}
function renderMap() {
  const root=$('tiles'); root.replaceChildren(); $('connections').replaceChildren();
  const shown=report.parts.filter(p=>inScope(p) && matches(p));
  $('scope-count').textContent=`${shown.length} components in view`;
  $('map-empty').hidden=shown.length>0;
  const {width:w,height:h}=$('canvas').getBoundingClientRect();
  mapSize=`${w}:${h}`;
  if (!shown.length) return;
  if (state.view==='board') { renderBoard(shown,w,h); return; }
  const boardFiles = [...new Set(shown.map(p=>p.file))];
  const groupByBoard = !state.scope && boardFiles.length>1;
  const groups = new Map();
  for (const p of shown) {
    const key=groupByBoard?p.file:p.sheet;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(p);
  }
  // At sheet depth, the entire available area belongs to the parts.
  if (state.scope?.sheet) {
    pack(shown.map(p=>({p,weight:weight(p)})).sort((a,b)=>b.weight-a.weight),{x:4,y:4,w:w-8,h:h-8},(item,r)=>tile(item.p,r,root));
    return;
  }
  const items=[...groups].map(([key,ps])=>({key,ps,weight:ps.reduce((s,p)=>s+weight(p),0)})).sort((a,b)=>b.weight-a.weight);
  pack(items,{x:3,y:3,w:w-6,h:h-6},(group,r)=> {
    const node=el('div',undefined,'group'); position(node,r,3);
    const title=el('button',undefined,'group-title'); title.append(el('span',groupByBoard?shortFile(group.key):group.key==='/'?'Root sheet':group.key),el('small',`${group.ps.length} parts ↗`));
    title.setAttribute('aria-label',`Open ${group.key==='/'?'Root sheet':group.key}`);
    title.onclick=()=>setScope(groupByBoard?{file:group.key}:{file:group.ps[0].file,sheet:group.key}); node.append(title);
    const inner={x:2,y:30,w:Math.max(1,r.w-10),h:Math.max(1,r.h-38)};
    pack(group.ps.map(p=>({p,weight:weight(p)})).sort((a,b)=>b.weight-a.weight),inner,(item,box)=>tile(item.p,box,node));
    root.append(node);
  },90);
}
function renderBoard(shown,w,h) {
  const files=[...new Set(shown.map(p=>p.file))];
  if (files.length>1) {
    const chooser=el('div',undefined,'board-chooser');
    chooser.append(el('p','Choose a board to view its physical layout.'));
    for (const file of files) {
      const button=el('button',file); button.onclick=()=>setScope({file}); chooser.append(button);
    }
    $('tiles').append(chooser);
    return;
  }
  const xs=shown.map(p=>p.x),ys=shown.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys);
  const scale=Math.min((w-55)/Math.max(1,maxX-minX),(h-55)/Math.max(1,maxY-minY));
  const ox=(w-(maxX-minX)*scale)/2,oy=(h-(maxY-minY)*scale)/2;
  for (const p of shown) {
    const size=Math.min(36,Math.max(13,Math.sqrt(weight(p))*5));
    tile(p,{x:ox+(p.x-minX)*scale-size/2,y:oy+(p.y-minY)*scale-size/2,w:size,h:size},$('tiles'));
  }
  $('tiles').append(el('span','Footprint centers · not copper routing · not to scale','board-note'));
}
function highlight(id) {
  state.hover=id;
  if (state.selected) return;
  const p=parts.get(id), result=reach(report,id,state), affected=new Set(result.ids);
  const root=$('canvas').getBoundingClientRect(), centers=new Map();
  for (const tile of $('tiles').querySelectorAll('.tile')) {
    const r=tile.getBoundingClientRect(); centers.set(tile.dataset.id,{x:r.x-root.x+r.width/2,y:r.y-root.y+r.height/2});
    tile.classList.toggle('hovered',tile.dataset.id===id);
    tile.classList.toggle('affected',affected.has(tile.dataset.id));
    tile.classList.toggle('dimmed',tile.dataset.id!==id && !affected.has(tile.dataset.id));
  }
  const svg=$('connections'); svg.replaceChildren();
  for (const edge of result.edges) {
    const a=centers.get(edge.source),b=centers.get(edge.target); if (!a || !b) continue;
    const d=`M ${a.x} ${a.y} C ${a.x} ${(a.y+b.y)/2-30}, ${b.x} ${(a.y+b.y)/2-30}, ${b.x} ${b.y}`;
    svg.append(svgEl('path',{d,fill:'none',stroke:edge.net.includes('V')?'#ffb66e':'#82bbdf','stroke-width':1.4,opacity:.65}));
  }
  const visible=result.ids.filter(id=>centers.has(id)).length;
  const title=`${p.ref} · ${result.ids.length} ${state.transitive?'transitively reachable parts':'shared-net neighbors'}`;
  impact(title,`${result.nets.length} nets · ${visible} neighbors in view · ${result.ids.length-visible} outside this view. ${state.includeGround?'Ground included.':'Ground excluded.'} ${state.transitive?'Structural reach through components, not signal propagation. ':''}${result.nets.slice(0,7).join(' · ')}${result.nets.length>7?' …':''}`);
}
function impact(title,text) {
  const box=$('impact'); box.replaceChildren(el('span',undefined,'impact-dot'));
  const body=el('div');body.append(el('strong',title),el('p',text));box.append(body);
}
function resetImpact() {
  state.hover=null;
  $('connections').replaceChildren();
  for (const tile of $('tiles').querySelectorAll('.tile')) tile.classList.remove('hovered','affected','dimmed');
  if (!state.selected) impact('Follow the electrical impact','Hover or focus a part to see everything sharing its nets, across both revisions. Ground is excluded by default.');
}
function format(value) {
  if (value===undefined || value===null || value==='') return '∅';
  if (typeof value==='object') return JSON.stringify(value,null,2);
  return String(value);
}
function openDiff(p) {
  state.selected=p.id; resetImpact(); $('map-panel').hidden=true;
  const panel=$('diff-panel'); panel.hidden=false; panel.replaceChildren();
  const head=el('div',undefined,'diff-header'),title=el('h2',p.ref);title.append(el('small',p.status));
  const close=el('button','← Back to map','close-diff');close.onclick=closeDiff;head.append(title,close);
  panel.append(head,el('p',`${p.file} · ${p.sheet} · ${p.value || p.footprint}`,'diff-subtitle'));
  const regions=el('div',undefined,'regions');
  const extent=Math.max(8,...[p.before,p.after].filter(Boolean).flatMap(part=>part.pads.map(pad=>{
    const pos=padPosition(part,pad),angle=pad.angle*Math.PI/180;
    const rx=(Math.abs(pad.w*Math.cos(angle))+Math.abs(pad.h*Math.sin(angle)))/2;
    const ry=(Math.abs(pad.w*Math.sin(angle))+Math.abs(pad.h*Math.cos(angle)))/2;
    return Math.max(Math.abs(pos.x)+rx,Math.abs(pos.y)+ry);
  })))*1.25;
  for (const key of ['before','after']) {
    const figure=el('figure',undefined,'region'); figure.append(el('figcaption',`${key==='before'?'BASE':'HEAD'} · local pad region · ${extent.toFixed(1)} mm radius · custom shapes approximate`));
    figure.append(regionSvg(p,key,extent));regions.append(figure);
  }
  panel.append(regions);
  const table=el('table',undefined,'semantic'),tr=el('tr');
  for (const name of ['Field / pin','Base','Head']) tr.append(el('th',name)); table.append(tr);
  const row=(field,a,b)=>{const tr=el('tr');tr.append(el('td',field));for(const value of [a,b]) {const td=el('td');td.append(el('code',format(value)));tr.append(td);}table.append(tr);};
  const changes=p.changes;
  if (p.before && p.after) {
    for (const c of changes) {
      if (c.field==='pins') {
        for (const pin of [...new Set([...Object.keys(c.before),...Object.keys(c.after)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))) {
          if (JSON.stringify(c.before[pin])!==JSON.stringify(c.after[pin])) row(`Pin ${pin}`,c.before[pin]?.join(', '),c.after[pin]?.join(', '));
        }
      } else row(c.field,c.before,c.after);
    }
    if (!changes.length) row('Component','No semantic changes','No semantic changes');
  } else {
    for (const key of ['value','footprint','sheet','side','fields','pins']) row(key,p.before?.[key],p.after?.[key]);
  }
  panel.append(table); impact(`${p.ref} · ${reach(report,p.id,state).ids.length} connected parts`, 'The diff compares footprint properties and numbered pad connectivity. Local regions show pads and nearby footprints. Copper tracks, zones and DRC/ERC are outside this review.');
  close.focus();
}
function closeDiff() {const id=state.selected;state.selected=null;$('diff-panel').hidden=true;$('map-panel').hidden=false;renderMap();resetImpact();const target=[...$('tiles').querySelectorAll('.tile'),...$('part-list').children].find(n=>n.dataset.id===id);(target ?? $('map-tab')).focus();}
function padPosition(part,pad) {
  const angle=part.angle*Math.PI/180;
  return {x:pad.x*Math.cos(angle)+pad.y*Math.sin(angle),y:-pad.x*Math.sin(angle)+pad.y*Math.cos(angle)};
}
function regionSvg(selected,key,extent) {
  const svg=svgEl('svg',{viewBox:`${-extent} ${-extent} ${extent*2} ${extent*2}`,role:'img','aria-label':`${key} pad region for ${selected.ref}`});
  const anchor=selected[key];
  if (!anchor) {const label=svgEl('text',{'text-anchor':'middle',fill:'#8a9da9','font-size':extent/6});label.textContent=key==='before'?'Not present in base':'Removed in head';svg.append(label);return svg;}
  for (const p of report.parts) {
    const part=p[key]; if (!part || part.file!==anchor.file) continue;
    const dx=part.x-anchor.x,dy=part.y-anchor.y;
    if (Math.abs(dx)>extent*2 || Math.abs(dy)>extent*2) continue;
    for (const pad of part.pads) {
      const pos=padPosition(part,pad),x=dx+pos.x,y=dy+pos.y;
      const color=p.id===selected.id?(key==='before'?'#e98496':'#6fdbb0'):'#3d5666';
      const rect=svgEl('rect',{x:x-pad.w/2,y:y-pad.h/2,width:pad.w,height:pad.h,rx:['circle','oval'].includes(pad.shape)?Math.min(pad.w,pad.h)/2:.12,fill:color,opacity:p.id===selected.id?.9:.4,transform:`rotate(${-pad.angle} ${x} ${y})`});svg.append(rect);
      if (pad.drill?.length) {
        const oval=pad.drill[0]==='oval',dw=Number(pad.drill[oval?1:0]),dh=oval?Number(pad.drill[2]):dw;
        const offset=pad.drill.find(n=>Array.isArray(n) && n[0]==='offset') ?? [];
        if (dw>0 && dh>0) {
          const hole=svgEl('rect',{x:x-dw/2+Number(offset[1] ?? 0),y:y-dh/2+Number(offset[2] ?? 0),width:dw,height:dh,rx:Math.min(dw,dh)/2,fill:'#0e171e',stroke:color,'stroke-width':.08,transform:`rotate(${-pad.angle} ${x} ${y})`,'data-drill':pad.number});svg.append(hole);
        }
      }
      if (p.id===selected.id && pad.number) {const text=svgEl('text',{x,y:y+.17,'text-anchor':'middle',fill:'#0d171e','font-size':Math.min(.65,pad.h*.65)});text.textContent=pad.number;svg.append(text);}
    }
    if (p.id!==selected.id) {const label=svgEl('text',{x:dx,y:dy-1,fill:'#7c929f','font-size':extent/24,'text-anchor':'middle'});label.textContent=p.ref;svg.append(label);}
  }
  return svg;
}
async function init() {
  try {
    const response=await fetch('/api/report'); if (!response.ok) throw new Error(`Report request returned ${response.status}`);
    report=await response.json();parts=new Map(report.parts.map(p=>[p.id,p]));
    $('revision').textContent=`${report.base.slice(0,8)} → ${report.head.slice(0,8)}`;
    $('project').textContent=report.boards.length===1?report.boards[0]:`${report.boards.length} boards · ${report.boards.map(shortFile).join(' / ')}`;
    $('change-count').textContent=report.stats.changed;
    for (const [key,label] of [['parts','parts'],['nets','nets'],['sheets','sheets'],['changed','changed'],['affected','affected']]) {
      const box=el('div',undefined,['changed','affected'].includes(key)?'accent':'');box.append(el('strong',report.stats[key]),el('span',label));
      box.title=key==='affected'?'Unchanged direct shared-net neighbors of changed parts, excluding ground, across both revisions.':key==='parts'?'Parts in head; removed parts remain visible in the map.':'';
      $('stats').append(box);
    }
    $('selection').textContent=`${report.selection} · ${report.boards.length} / ${report.availableBoards.length} boards`;
    $('search').oninput=e=>{state.query=e.target.value.trim().toLowerCase();renderList();if(!state.selected){renderMap();resetImpact();}};
    $('only-changed').onchange=renderList;
    $('reach').onchange=e=>{state.transitive=e.target.value==='transitive';if(state.hover) highlight(state.hover);};
    $('ground').onchange=e=>{state.includeGround=e.target.checked;if(state.hover) highlight(state.hover);};
    for (const [id,view] of [['map-tab','map'],['board-tab','board']]) $(id).onclick=()=>{state.view=view;$(id).classList.add('active');$(id==='map-tab'?'board-tab':'map-tab').classList.remove('active');if(state.selected) closeDiff();renderMap();resetImpact();};
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && state.selected) closeDiff();});
    resize=new ResizeObserver(()=>{
      const box=$('canvas').getBoundingClientRect(),size=`${box.width}:${box.height}`;
      if(!state.selected && box.width>0 && box.height>0 && size!==mapSize){mapSize=size;renderMap();resetImpact();}
    });resize.observe($('canvas'));
    breadcrumb();renderList();renderMap();
  } catch(error) {$('project').textContent=`Could not load this review. ${error.message}. Restart boardmap and reload this page.`;}
}
init();

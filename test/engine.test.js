import {test} from 'node:test';
import {get} from 'node:http';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from '../src/sexpr.js';
import {readBoard} from '../src/board.js';
import {compare,reach} from '../src/compare.js';
import {buildReport,git} from '../src/git.js';
import {serve} from '../src/server.js';
const fixture = name => readFileSync(new URL(`fixtures/${name}`,import.meta.url),'utf8');
const fp = (ref, net, value='10k') => `(footprint "R_0603" (layer "F.Cu") (at 10 20) (property "Reference" "${ref}") (property "Value" "${value}") (pad "1" smd rect (at 0 0) (size 1 2) (net 1 "${net}")))`;
const board = (...parts) => `(kicad_pcb (version 20240108) ${parts.join(' ')})`;
const read = text => readBoard(text,'main.kicad_pcb');
test('s-expressions preserve quoted content and reject malformed input',()=> {
  assert.deepEqual(parse('(a "b\\\"c" (d 1))'),['a','b"c',['d','1']]);
  for (const text of ['(',')','(a "oops)','(a)(b)']) assert.throws(()=>parse(text));
});
test('real upstream boards parse and retain nets and footprint geometry',()=> {
  for (const name of ['hackrf/LNA915.kicad_pcb','corne/corne-cherry.kicad_pcb']) {
    const parts = read(fixture(name));
    assert.ok(parts.length>10); assert.ok(parts.some(p=>Object.values(p.pins).flat().some(Boolean)));
    assert.ok(parts.every(p=>Number.isFinite(p.x)));
    const same = compare(parts,parts);
    assert.equal(same.stats.changed,0);
    assert.ok(same.stats.nets>0);
    assert.ok(Object.values(same.nets).every(n=>n.status==='unchanged'));
  }
});
test('component, pin-net, addition, removal, and pad changes are semantic',()=> {
  const before = read(board(fp('R1','3V3'),fp('R2','GND')));
  const after = read(board(fp('R1','5V','1k'),fp('R3','5V')));
  const report = compare(before,after);
  assert.deepEqual(report.parts.map(p=>p.status),['modified','removed','added']);
  assert.deepEqual(report.parts[0].changes.map(c=>c.field),['value','pins']);
  assert.equal(report.stats.changed,3);
});
test('reach includes removed nets, excludes ground by default and stays within boards',()=> {
  const a = read(board(fp('U1','3V3'),fp('C1','3V3'),fp('R1','GND'),fp('R2','GND')));
  const b = read(board(fp('U1','5V'),fp('C1','3V3'),fp('R1','GND'),fp('R2','GND')));
  const other = readBoard(board(fp('C9','3V3')),'other.kicad_pcb');
  const report = compare([...a,...other],[...b,...other]);
  assert.deepEqual(reach(report,'main.kicad_pcb::U1').ids,['main.kicad_pcb::C1']);
  assert.equal(reach(report,'main.kicad_pcb::R1').ids.length,0);
  assert.equal(reach(report,'main.kicad_pcb::R1',{includeGround:true}).ids.length,1);
});
test('transitive traversal reaches beyond a two-pin bridge',()=> {
  const parts = read(board(fp('U1','A'),fp('R1','A').slice(0,-1)+' (pad "2" smd rect (net 2 "B")))',fp('U2','B')));
  const report = compare(parts,parts);
  assert.equal(reach(report,'main.kicad_pcb::U1').ids.length,1);
  assert.equal(reach(report,'main.kicad_pcb::U1',{transitive:true}).ids.length,2);
});
test('git revision reads do not change dirty working files; removed boards survive',()=> {
  const dir = mkdtempSync(join(tmpdir(),'boardmap-test-'));
  try {
    git(dir,['init','-q']); git(dir,['config','user.name','Test']); git(dir,['config','user.email','test@example.com']);
    writeFileSync(join(dir,'board.kicad_pcb'),board(fp('R1','3V3')));
    git(dir,['add','.']); git(dir,['commit','-qm','base']); const base = git(dir,['rev-parse','HEAD']).trim();
    git(dir,['rm','board.kicad_pcb']); git(dir,['commit','-qm','remove']);
    writeFileSync(join(dir,'scratch'),'dirty');
    const report = buildReport(dir,base,'HEAD');
    assert.equal(report.parts[0].status,'removed'); assert.equal(report.stats.parts,0);
    assert.equal(readFileSync(join(dir,'scratch'),'utf8'),'dirty');
    assert.throws(()=>buildReport(dir,'--all','HEAD'));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('loopback server rejects hostile Host, Origin, paths and methods',async()=> {
  const server = await serve({parts:[]}); const port = server.address().port, url=`http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(url+'/api/report')).status,200);
    assert.equal(await new Promise(resolve => get(url+'/api/report',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);})),403);
    assert.equal((await fetch(url+'/api/report',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(url+'/LICENSE')).status,404);
    assert.equal((await fetch(url+'/api/report',{method:'POST'})).status,405);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('drill changes are detected and pad serialization order is ignored',()=> {
  const one = fp('J1','A').slice(0,-1)+' (pad "2" thru_hole circle (drill 0.8) (net 2 "B")))';
  const a = read(board(one));
  const b = read(board(one.replace('drill 0.8','drill 1.2')));
  assert.equal(compare(a,b).parts[0].status,'modified');
  const c = structuredClone(a); c[0].pads.reverse();
  assert.equal(compare(a,c).stats.changed,0);
});
test('duplicate references match by UUID jointly across revisions',()=> {
  const a = fp('TP','A').slice(0,-1)+' (uuid "first"))';
  const b = fp('TP','A').slice(0,-1)+' (uuid "second"))';
  const report = compare(read(board(a)),read(board(a,b)));
  assert.deepEqual(report.parts.map(p=>p.status),['unchanged','added']);
});
test('git reads work from repository subdirectories',()=> {
  const report = buildReport(new URL('../src',import.meta.url).pathname,'HEAD','HEAD');
  assert.ok(report.parts.length>10);
});

test('shape details, assembly flags and simultaneous geometry/net changes survive',()=> {
  const text=fixture('corne/corne-cherry.kicad_pcb'), before=read(text);
  for (const after of [text.replace('(roundrect_rratio 0.25)','(roundrect_rratio 0.5)'),text.replace('exclude_from_bom','dnp')]) {
    assert.ok(compare(before,read(after)).stats.changed>0);
  }
  const custom=board(fp('U1','A').replace('(size 1 2)','(size 1 2) (primitives (gr_poly (pts (xy 0 0) (xy 1 0) (xy 0 1)) (width 0)))'));
  assert.equal(compare(read(custom),read(custom.replace('(xy 1 0)','(xy 1.1 0)'))).stats.changed,1);
  const a=read(board(fp('R1','A'))),b=read(board(fp('R1','B').replace('(size 1 2)','(size 2 2)')));
  assert.deepEqual(compare(a,b).parts[0].changes.map(c=>c.field),['pins','pads']);
});
test('KiCad 10 name-only nets and lowercase sheet metadata are retained',()=> {
  const text=board(fp('U1','VIN').replace('(net 1 "VIN")','(net "VIN")').slice(0,-1)+' (sheetname "/Power") (sheetfile "power.kicad_sch"))');
  const parts=read(text);assert.deepEqual(parts[0].pins['1'],['VIN']);assert.equal(parts[0].sheet,'/Power');
  assert.equal(compare(parts,parts).stats.nets,1);
});
test('named pads cannot collide with object prototype keys',()=> {
  const part=read(board(fp('J1','A').replace('pad "1"','pad "constructor"')))[0];
  assert.deepEqual(part.pins.constructor,['A']);
  assert.deepEqual(read(board(fp('J1','A').replace('pad "1"','pad "__proto__"')))[0].pins.__proto__,['A']);
});
test('affected union scans shared nets and excludes every changed part',()=> {
  const parts=Array.from({length:4000},(_,i)=>({...read(board(fp(`R${i}`,'VCC')))[0]}));
  assert.equal(compare([],parts).stats.affected,0);
  const after=structuredClone(parts);after[0].value='1k';
  assert.equal(compare(parts,after).stats.affected,3999);
});
test('diff.relative cannot redirect changed-board selection from a subdirectory',()=> {
  const dir=mkdtempSync(join(tmpdir(),'boardmap-relative-'));
  try {
    git(dir,['init','-q']);git(dir,['config','user.name','Test']);git(dir,['config','user.email','test@example.com']);git(dir,['config','diff.relative','true']);
    mkdirSync(join(dir,'prototype'));
    for(const file of ['main.kicad_pcb','prototype/main.kicad_pcb'])writeFileSync(join(dir,file),board(fp('R1','A')));
    git(dir,['add','.']);git(dir,['commit','-qm','base']);const base=git(dir,['rev-parse','HEAD']).trim();
    writeFileSync(join(dir,'prototype/main.kicad_pcb'),board(fp('R1','B')));git(dir,['add','.']);git(dir,['commit','-qm','head']);
    const result=buildReport(join(dir,'prototype'),base,'HEAD');
    assert.deepEqual(result.boards,['prototype/main.kicad_pcb']);assert.equal(result.stats.changed,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

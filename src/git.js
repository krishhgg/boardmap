import {execFileSync} from 'node:child_process';
import {readBoard} from './board.js';
import {compare} from './compare.js';
export function git(repo,args) {
  return execFileSync('git',['-C',repo,...args],{encoding:'utf8',maxBuffer:100*1024*1024,stdio:['ignore','pipe','pipe']});
}
export function revision(repo,ref) {
  // Resolve untrusted refs before using them in revision:path expressions.
  return git(repo,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]).trim();
}
export function buildReport(repo,base,head,{board} = {}) {
  const a = revision(repo,base), b = revision(repo,head);
  const files = sha => git(repo,['ls-tree','-r','--name-only','-z',sha]).split('\0').filter(p=>p.endsWith('.kicad_pcb'));
  const af = files(a), bf = files(b), all = [...new Set([...af,...bf])].sort();
  if (!all.length) throw new Error('No .kicad_pcb files at either revision. Schematic-only projects are not supported yet.');
  const changed = new Set(git(repo,['diff','--name-only','--no-renames','-z',a,b]).split('\0'));
  const selected = board ? all.filter(f=>f===board) : all.filter(f=>changed.has(f));
  if (board && !selected.length) throw new Error(`Board not found at either revision: ${board}`);
  const chosen = selected.length ? selected : all;
  const load = (sha,existing) => chosen.filter(f=>existing.includes(f)).flatMap(file=>readBoard(git(repo,['show',`${sha}:${file}`]),file));
  return compare(load(a,af),load(b,bf),{base:a,head:b,boards:chosen,availableBoards:all,
    selection:board?'explicit':selected.length?'changed boards':'all boards'});
}

import {mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {git} from '../src/git.js';
export const demos = {
  hackrf:{url:'https://github.com/greatscottgadgets/hackrf.git',pr:1411,
    base:'f6598e7b14b7ec539126479e9c6d095c668a534e',head:'3bdc5547004c8244de5f37104410c363854e5634'},
  corne:{url:'https://github.com/foostan/crkbd.git',pr:237,
    base:'a935f345c5e824aeaaa8f624ae2134fae47e128e',head:'eaf6e072fe273c2cfd64690de135ddb7ffe870f9',board:'pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb'}
};
const [name,...extra] = process.argv.slice(2), demo=demos[name];
if (!demo) {console.error('Usage: node scripts/demo.mjs <hackrf|corne> [boardmap options]');process.exitCode=1;}
else {
  const dir=join(tmpdir(),'boardmap-demos',name);mkdirSync(dir,{recursive:true});
  try {
    git(dir,['init','-q']);
    console.log(`Fetching ${name} PR #${demo.pr} into ${dir}. No checkout.`);
    git(dir,['fetch','--depth=1',demo.url,demo.base,demo.head]);
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/boardmap.js',import.meta.url)),demo.base,demo.head,'--repo',dir,...(demo.board?['--board',demo.board]:[]),...extra],{stdio:'inherit'});
    process.exitCode=result.status ?? 1;
  } catch(error) {console.error(error.stderr?.toString() || error.message);process.exitCode=1;}
}

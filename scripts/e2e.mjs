import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {buildReport} from '../src/git.js';
import {serve} from '../src/server.js';
const {values} = parseArgs({options:{repo:{type:'string'},base:{type:'string'},head:{type:'string'},board:{type:'string'},out:{type:'string'}}});
const report=buildReport(values.repo ?? '.',values.base ?? 'HEAD',values.head ?? 'HEAD',{board:values.board});
const server=await serve(report), browser=await chromium.launch({executablePath:process.env.BOARDMAP_BROWSER || undefined});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const out=values.out;
if(out) await mkdir(out,{recursive:true});
const capture=async name=>{if(out) await page.screenshot({path:`${out}/${name}.png`,fullPage:true});};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.tile').first().waitFor();
  assert.equal(await page.locator('.tile').count(),report.parts.length);
  assert.equal(await page.locator('.part-row').count(),report.stats.changed);
  await capture('map');
  // Pick a large, connected part so screenshots and assertions cover real geometry.
  const candidate=[...report.parts].filter(p=>p.after).sort((a,b)=>Object.keys(b.pins).length-Object.keys(a.pins).length)[0];
  const tile=page.locator('.tile').filter({has:page.locator('span.ref',{hasText:new RegExp(`^${candidate.ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)})}).first();
  await tile.hover();
  assert.ok(await page.locator('#connections path').count()>0,'hover draws net paths');
  assert.ok(await page.locator('.affected').count()>0,'neighbors highlighted');
  await capture('reach');
  await page.locator('#reach').selectOption('transitive');
  await tile.hover();
  assert.match(await page.locator('#impact').innerText(),/transitively reachable/);
  await page.locator('#ground').check();
  await tile.hover();
  assert.match(await page.locator('#impact').innerText(),/Ground included/);
  await page.locator('#ground').uncheck();await page.locator('#reach').selectOption('direct');
  await tile.click();await page.locator('#diff-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('.region svg').count(),2);
  assert.ok(await page.locator('.semantic tr').count()>1);
  await capture('diff');
  await page.keyboard.press('Escape');await page.locator('#map-panel').waitFor({state:'visible'});
  await page.locator('.group-title').first().click();
  assert.ok(await page.locator('.tile').count()<=report.parts.length);
  assert.match(await page.locator('#breadcrumbs').innerText(),/\//);
  await capture('sheet');
  await page.locator('#breadcrumbs button').first().click();
  await page.locator('#search').fill(candidate.ref);
  assert.ok(await page.locator('.tile').count()<report.parts.length);
  await page.locator('#search').fill('no-component-matches-this');
  await page.locator('#map-empty').waitFor({state:'visible'});
  await page.locator('#search').fill('');
  await page.locator('#only-changed').uncheck();
  assert.equal(await page.locator('.part-row').count(),report.parts.length);
  await page.locator('#board-tab').click();
  if(report.boards.length>1) {
    const choices=page.locator('.board-chooser button');
    assert.equal(await choices.count(),report.boards.length);
    await choices.last().click();
    assert.ok(await page.locator('.tile').count()>0);
    assert.ok((await page.locator('#breadcrumbs').innerText()).includes(report.boards.at(-1).split('/').at(-1).replace('.kicad_pcb','')));
  }
  await capture('board');
  await page.locator('#map-tab').click();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile horizontal overflow');
  if(report.boards.length===1) {
    await page.locator('#breadcrumbs button').first().click();
    for(const group of await page.locator('.group-title').all()) {
      const box=await group.boundingBox();assert.ok(box.width>=60 && box.height>=24,'small sheets retain visible drill targets');
    }
  }
  await capture('mobile');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${report.parts.length} parts, ${report.stats.changed} changes; map, reach, transitive, ground, diff, drill-in, breadcrumbs, search, layout, mobile; no browser errors.`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}

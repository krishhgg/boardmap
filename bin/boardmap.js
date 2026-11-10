#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {buildReport} from '../src/git.js';
import {serve} from '../src/server.js';
try {
  const {values,positionals} = parseArgs({allowPositionals:true,options:{
    repo:{type:'string'}, board:{type:'string'}, port:{type:'string'}, json:{type:'string'}, help:{type:'boolean',short:'h'}
  }});
  if (values.help) {
    console.log('Usage: boardmap <base> <head> [--repo PATH] [--board FILE] [--port 0] [--json FILE]\n\nReads KiCad boards from git objects. No checkout or KiCad installation.\nDefaults to changed boards; --board selects one exact repo-relative path.\n--json writes a report instead of starting the local server.');
  } else {
    if (positionals.length !== 2) throw new Error('Expected <base> <head>. Try boardmap --help.');
    const port = Number(values.port ?? 0);
    if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('Port must be an integer from 0 to 65535');
    const report = buildReport(values.repo ?? process.cwd(),...positionals,{board:values.board});
    if (values.json) { writeFileSync(values.json,JSON.stringify(report,null,2)+'\n'); console.log(`Wrote ${report.parts.length} parts to ${values.json}`); }
    else {
      const server = await serve(report,port);
      console.log(`boardmap  http://127.0.0.1:${server.address().port}\n${report.stats.parts} parts · ${report.stats.changed} changed · ${report.stats.affected} affected\n${report.selection}: ${report.boards.join(', ')}\nPress Ctrl+C to stop.`);
      for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close(()=>process.exit(0)));
    }
  }
} catch (error) { console.error(`boardmap: ${error.stderr?.toString().trim() || error.message}`); process.exitCode=1; }

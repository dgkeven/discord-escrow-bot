import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function check(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,item.name);
  if(item.isDirectory())check(path);
  else if(path.endsWith('.js')){const r=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
}}
check('src');check('scripts');check('test');console.log('Sintaxe válida.');

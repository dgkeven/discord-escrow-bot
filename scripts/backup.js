import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const source=resolve(process.env.DATABASE_PATH||'./data/escrow.sqlite');
if(!existsSync(source))throw new Error('Banco não encontrado. Configure DATABASE_PATH.');
mkdirSync('backups',{recursive:true});
const destination=resolve('backups',`escrow-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
await backup(db,destination);db.close();
const check=new DatabaseSync(destination);
const integrity=check.prepare('PRAGMA integrity_check').get();
if(integrity.integrity_check!=='ok')throw new Error('Backup falhou na verificação de integridade.');
// A restored backup must not inherit a lease belonging to the original process.
if(check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime'").get())check.exec('DELETE FROM runtime');
check.close();console.log(destination);

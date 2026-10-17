import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {convert} from './convert-postgres-to-d1.mjs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const root=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const dir=mkdtempSync(join(tmpdir(),'hit2-production-'));
const url='https://hit2-boss-production.qaz0971394717.workers.dev';
const vars={PRODUCTION_MODE:'true',ENABLE_LINE:'true',ENABLE_ADMIN:'true'};
const base={name:'hit2-boss-production',main:resolve('src/production.js'),compatibility_date:'2026-10-01',vars};
const key=crypto.randomUUID()+crypto.randomUUID();
let stage='preflight',paused=false,activationAttempted=false,createdId,restoreId;
function config(name,value){const path=join(dir,name+'.json');writeFileSync(path,JSON.stringify(value));return path;}
const normalConfig=config('neon',base),pausedConfig=config('maintenance',{...base,vars:{...vars,MIGRATION_MODE:'true'}});
function cli(args,input){return execFileSync(resolve('node_modules/.bin/wrangler'),args,{stdio:'pipe',input,env:process.env,timeout:180000});}
async function api(path,body,method=body?'POST':'GET'){
 const response=await fetch(root+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok||!data.success)throw Error('Cloud API failure');return data.result;
}
const tables=['boss_types','boss_kills','chat_settings','staging_admin_challenges','staging_line_events'];
const schema=readFileSync('d1/0001_core.sql','utf8');
function digest(rows){return createHash('sha256').update(JSON.stringify(rows.map(r=>JSON.stringify(r)).sort())).digest('hex');}
try{
 const health=await (await fetch(url)).json();
 if(health.mode!=='production'||health.database_backend==='d1')throw Error('Production is not an unmigrated Neon source');
 for(const required of ['R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ENDPOINT'])if(!process.env[required])throw Error('Missing R2 credential');
 const name='hit2-boss-d1-production-'+process.env.GITHUB_RUN_ID;
 createdId=(await api('/d1/database',{name})).uuid;
 const binding={binding:'BOSS_DB',database_name:name,database_id:createdId};
 const finalConfig=config('d1',{...base,vars:{...vars,DATABASE_BACKEND:'d1'},d1_databases:[binding]});
 stage='install-maintenance-secret';cli(['secret','put','MIGRATION_KEY','--config',normalConfig],key+'\n');
 stage='pause-production';paused=true;cli(['deploy','--config',pausedConfig]);
 for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,20000));console.log('Waiting for production in-flight requests to drain:',(i+1)*20,'seconds.');}
 stage='snapshot-production-source';
 const response=await fetch(url+'/__migration/snapshot',{method:'POST',headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Production snapshot unavailable');
 const snapshot=await response.json();
 if(new Set(snapshot.boss_kills.map(row=>row.chat_id)).size<2)throw Error('Expected production group scopes missing');
 const converted=convert(snapshot);
 const local=new DatabaseSync(':memory:');local.exec(schema);local.exec(converted.sql);
 const input=join(dir,'snapshot.sql');writeFileSync(input,schema+'\n'+converted.sql,{mode:0o600});
 stage='import-production-d1';cli(['d1','execute','BOSS_DB','--remote','--file',input,'--config',finalConfig,'--yes']);
 async function compare(id){
  for(const table of tables){const expected=local.prepare(`SELECT * FROM ${table}`).all();const columns=local.prepare(`SELECT * FROM ${table}`).columns().map(c=>c.name);
   const actual=(await api('/d1/database/'+id+'/query',{sql:`SELECT ${columns.join(',')} FROM ${table}`}))[0].results;
   if(digest(actual.map(r=>columns.map(c=>r[c])))!==digest(expected.map(r=>columns.map(c=>r[c]))))throw Error('Snapshot mismatch');
   console.log('Production verified table:',table,'rows:',expected.length);
  }
 }
 stage='compare-production-import';await compare(createdId);
 stage='backup-production-to-r2';const backup=join(dir,'backup.sql');cli(['d1','export','BOSS_DB','--remote','--output',backup,'--config',finalConfig]);
 execFileSync('python3',['-c',`import os,boto3,hashlib
s=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'].rstrip('/'),aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto')
a=os.environ['BACKUP_FILE'];key='d1-production/migration-'+os.environ['GITHUB_RUN_ID']+'.sql'
s.upload_file(a,'hit2-neon-backup',key)
s.download_file('hit2-neon-backup',key,a+'.download')
assert hashlib.sha256(open(a,'rb').read()).digest()==hashlib.sha256(open(a+'.download','rb').read()).digest()
`],{env:{...process.env,BACKUP_FILE:backup},stdio:'pipe',timeout:120000});
 stage='restore-production-backup';restoreId=(await api('/d1/database',{name:'hit2-production-restore-'+process.env.GITHUB_RUN_ID})).uuid;
 const restoreConfig=config('restore',{...base,d1_databases:[{...binding,database_id:restoreId}]});
 cli(['d1','execute','BOSS_DB','--remote','--file',backup+'.download','--config',restoreConfig,'--yes']);await compare(restoreId);local.close();
 stage='activate-production-d1';activationAttempted=true;cli(['deploy','--config',finalConfig]);
 let healthy=false;
 for(let attempt=0;attempt<6;attempt++){
  try { const response=await fetch(url,{cache:'no-store'}); const after=await response.json(); healthy=response.ok&&after.database_backend==='d1'&&after.line_enabled&&after.admin_enabled&&!after.reminders_enabled; } catch {}
  if(healthy)break;
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
 if(!healthy)throw Error('Production health requires independent verification');
 console.log('PRODUCTION_D1_DATABASE_ID='+createdId);
 console.log('PASS: production now uses D1; original production data preserved; private R2 backup restored and compared. Existing Neon data retained for rollback.');
}catch(error){console.error('Production migration failed at:',stage,'type:',error.name);process.exitCode=1;
 if(paused&&!activationAttempted){try{cli(['deploy','--config',normalConfig]);console.log('Production restored to Neon before D1 activation.');}catch{console.error('Unable to restore production configuration; operator attention required.');}}
 if(activationAttempted)console.error('D1 activation was attempted. Do not revert automatically: new writes may exist.');
}finally{
 if(restoreId){try{await api('/d1/database/'+restoreId,undefined,'DELETE');console.log('Removed production restore drill database.');}catch{console.error('Restore drill cleanup failed.');process.exitCode=1;}}
 if(paused){try{await api('/workers/scripts/hit2-boss-production/secrets/MIGRATION_KEY',undefined,'DELETE');}catch{console.error('Temporary secret cleanup failed; route remains disabled after successful activation.');}}
 rmSync(dir,{recursive:true,force:true});
}

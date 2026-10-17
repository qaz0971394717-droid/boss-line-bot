import {neon} from '@neondatabase/serverless';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {convert} from './convert-postgres-to-d1.mjs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN;
const root=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const dir=mkdtempSync(join(tmpdir(),'hit2-drill-')),ids=[];
let stage='source-snapshot';
async function api(path='',body,method=body?'POST':'GET'){
 const res=await fetch(root+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await res.json();if(!res.ok||!data.success)throw Error('Cloud API failure');return data.result;
}
const schema=readFileSync(new URL('../d1/0001_core.sql',import.meta.url),'utf8');
const tables=['boss_types','boss_kills','chat_settings','staging_admin_challenges','staging_line_events'];
const run=process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
const wrangler=join(process.cwd(),'node_modules/.bin/wrangler');
function cli(args){execFileSync(wrangler,args,{stdio:'pipe',env:process.env,timeout:180000});}
function config(id){const path=join(dir,id+'.json');writeFileSync(path,JSON.stringify({name:'hit2-d1-drill',compatibility_date:'2026-10-01',d1_databases:[{binding:'BOSS_DB',database_name:'hit2-drill',database_id:id}]}));return path;}
function digest(rows){return createHash('sha256').update(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort())).digest('hex');}
try{
 // A single SELECT gives a consistent PostgreSQL statement snapshot without writes.
 const source=neon(process.env.DATABASE_URL);
 const expression=tables.map(t=>`'${t}',(SELECT coalesce(json_agg(x),'[]'::json) FROM ${t} x)`).join(',');
 const snapshot=(await source.query(`SELECT json_build_object(${expression}) AS snapshot`))[0].snapshot;
 const converted=convert(snapshot);
 const local=new DatabaseSync(':memory:');local.exec(schema);local.exec(converted.sql);
 const created=await api('',{name:'hit2-migration-drill-'+run});ids.push(created.uuid);const firstConfig=config(created.uuid);
 stage='import-to-isolated-d1';
 const input=join(dir,'import.sql');writeFileSync(input,schema+'\n'+converted.sql,{mode:0o600});
 cli(['d1','execute','BOSS_DB','--remote','--file',input,'--config',firstConfig,'--yes']);
 async function compare(id){
  for(const table of tables){
   const expected=local.prepare(`SELECT * FROM ${table}`).all();
   const columns=Object.keys(expected[0]||local.prepare(`SELECT * FROM ${table}`).columns().reduce((out,c)=>({...out,[c.name]:null}),{}));
   const response=await api('/'+id+'/query',{sql:`SELECT ${columns.join(',')} FROM ${table}`});
   const actual=response[0].results;
   if(digest(actual.map(r=>columns.map(c=>r[c])))!==digest(expected.map(r=>columns.map(c=>r[c]))))throw Error('Data mismatch');
   console.log('Verified table:',table,'rows:',expected.length);
  }
 }
 stage='verify-import';await compare(created.uuid);
 stage='export-real-d1';const exported=join(dir,'backup.sql');
 cli(['d1','export','BOSS_DB','--remote','--output',exported,'--config',firstConfig]);
 stage='r2-roundtrip';
 execFileSync('python3',['-c',`import os,boto3,hashlib
s=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'].rstrip('/'),aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto')
a=os.environ['DRILL_FILE']; b=a+'.download'; key='d1-validation/'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT']+'.sql'
try:
 s.upload_file(a,'hit2-neon-backup',key)
 s.download_file('hit2-neon-backup',key,b)
 assert hashlib.sha256(open(a,'rb').read()).digest()==hashlib.sha256(open(b,'rb').read()).digest()
finally:
 s.delete_object(Bucket='hit2-neon-backup',Key=key)
`],{env:{...process.env,DRILL_FILE:exported},stdio:'pipe',timeout:120000});
 stage='restore-from-r2';const restored=await api('',{name:'hit2-restore-drill-'+run});ids.push(restored.uuid);
 cli(['d1','execute','BOSS_DB','--remote','--file',exported+'.download','--config',config(restored.uuid),'--yes']);
 await compare(restored.uuid);local.close();
 console.log('PASS: Neon snapshot -> real D1 -> real D1 SQL export -> private R2 -> independent D1 restore, all five tables compared.');
}catch(e){console.error('Migration drill failed at:',stage,'type:',e.name);process.exitCode=1;}
finally{
 for(const id of ids){try{await api('/'+id,undefined,'DELETE');console.log('Removed isolated drill database.');}catch{console.error('Drill database cleanup failed; operator attention required.');process.exitCode=1;}}
 rmSync(dir,{recursive:true,force:true});
}

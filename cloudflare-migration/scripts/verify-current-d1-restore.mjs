import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database`;
async function api(path='',body,method=body?'POST':'GET'){
 const response=await fetch(root+path,{method,headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok||!data.success)throw Error('Restore API failed');return data.result;
}
const dir=mkdtempSync(join(tmpdir(),'hit2-restore-')),ids=[];
const cli=args=>execFileSync(resolve('node_modules/.bin/wrangler'),args,{stdio:'pipe',timeout:180000});
const identifier=name=>'"'+name.replaceAll('"','""')+'"';
const digest=rows=>createHash('sha256').update(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort())).digest('hex');
let stage='export';
try{
 for(const target of ['production','staging']){
  const sourceConfig=target==='production'?'wrangler.production.toml':'wrangler.d1-staging.toml';
  const file=join(dir,target+'.sql');stage=target+'-export';
  cli(['d1','export','BOSS_DB','--remote','--output',file,'--config',sourceConfig]);
  stage=target+'-r2-download';
  execFileSync('python3',['-c',`import os,boto3,hashlib
s=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'].rstrip('/'),aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto')
a=os.environ['RESTORE_FILE'];key='restore-validation/'+os.environ['GITHUB_RUN_ID']+'/'+os.environ['RESTORE_TARGET']+'.sql'
try:
 s.upload_file(a,'hit2-neon-backup',key);s.download_file('hit2-neon-backup',key,a+'.download')
 assert hashlib.sha256(open(a,'rb').read()).digest()==hashlib.sha256(open(a+'.download','rb').read()).digest()
finally:s.delete_object(Bucket='hit2-neon-backup',Key=key)
`],{env:{...process.env,RESTORE_FILE:file,RESTORE_TARGET:target},stdio:'pipe',timeout:120000});
  const local=new DatabaseSync(':memory:');local.exec(readFileSync(file+'.download','utf8'));
  const tables=local.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY name").all().map(x=>x.name);
  async function clone(suffix){
   const id=(await api('',{name:'hit2-current-restore-'+target+'-'+process.env.GITHUB_RUN_ID+'-'+suffix})).uuid;ids.push(id);
   const config=join(dir,id+'.json');writeFileSync(config,JSON.stringify({name:'restore-validation',compatibility_date:'2026-10-01',d1_databases:[{binding:'BOSS_DB',database_name:'restore-validation',database_id:id}]}));
   cli(['d1','execute','BOSS_DB','--remote','--file',file+'.download','--config',config,'--yes']);return id;
  }
  async function compare(id){for(const table of tables){
   const columns=local.prepare('SELECT * FROM '+identifier(table)).columns().map(c=>c.name);
   const expected=local.prepare('SELECT * FROM '+identifier(table)).all().map(r=>columns.map(c=>r[c]));
   const actual=(await api('/'+id+'/query',{sql:'SELECT * FROM '+identifier(table)}))[0].results.map(r=>columns.map(c=>r[c]));
   if(digest(expected)!==digest(actual))throw Error('Restored contents mismatch');
   console.log(target+' restore verified: '+table+' rows='+expected.length);
  }}
  stage=target+'-restore';const first=await clone('a');await compare(first);
  stage=target+'-simulate-loss';await api('/'+first+'/query',{sql:'DELETE FROM boss_kills'});
  const remaining=(await api('/'+first+'/query',{sql:'SELECT count(*) AS n FROM boss_kills'}))[0].results[0].n;if(remaining!==0)throw Error('Synthetic loss failed');
  stage=target+'-recover';const recovered=await clone('b');await compare(recovered);local.close();
  console.log('PASS: '+target+' backup restored after simulated loss in isolated databases; live data untouched.');
 }
}catch(error){console.error('Restore validation failed at:',stage,'type:',error.name);process.exitCode=1;}
finally{for(const id of ids){try{await api('/'+id,undefined,'DELETE');}catch{console.error('Temporary restore DB cleanup failed.');process.exitCode=1;}}rmSync(dir,{recursive:true,force:true});}

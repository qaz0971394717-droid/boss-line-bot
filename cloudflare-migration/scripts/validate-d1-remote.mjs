import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleLineCommand} from '../src/line-commands.js';
import {createSql} from '../src/database.js';
import {createEventStore} from '../src/events.js';
const account=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Missing Cloudflare credentials');
const root=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
async function api(path='',body,method=body?'POST':'GET'){
 const response=await fetch(root+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();
 if(!response.ok||!data.success)throw Error('D1 API failed: HTTP '+response.status+' codes '+JSON.stringify(data.errors?.map(x=>x.code)));
 return data.result;
}
const ids=[];
function binding(id){return {prepare(sql){return {bind(...params){return {async all(){const result=await api('/'+id+'/query',{sql,params});if(!result[0]?.success)throw Error('D1 query failed');return result[0];}};}};}};}
try {
 const name='hit2-validation-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
 const created=await api('',{name});ids.push(created.uuid);
 const schema=readFileSync(new URL('../d1/0001_core.sql',import.meta.url),'utf8');
 for(const sql of schema.split(';').filter(x=>x.trim()))await api('/'+created.uuid+'/query',{sql});
 const env={DATABASE_BACKEND:'d1',BOSS_DB:binding(created.uuid),STAGING_MODE:'true',ENABLE_STAGING_ADMIN:'true',ADMIN_PASSWORD:crypto.randomUUID()};
 const sql=createSql(env),now=new Date('2026-10-17T00:00:00Z');
 await sql`INSERT INTO boss_types(boss_key,boss_name,minutes) VALUES(${'驗證h'},${'驗證H'},${120})`;
 await handleLineCommand('HALF ON','validation-a',env,now);
 assert.match((await handleLineCommand('K 驗證H','validation-a',env,now)).text,/09:00:00/);
 assert.match((await handleLineCommand('KB','validation-b',env,now)).text,/沒有 BOSS/);
 assert.match((await handleLineCommand('測試','validation-a',env,now)).text,/Cloudflare D1/);
 await handleLineCommand('修改王 驗證H 180','validation-a',env,now);
 await handleLineCommand(env.ADMIN_PASSWORD,'validation-a',env,now);
 assert.equal((await sql`SELECT minutes FROM boss_types`)[0].minutes,180);
 const store=createEventStore(env);
 const claims=await Promise.all([store.claim('concurrent'),store.claim('concurrent')]);
 assert.deepEqual(claims.map(x=>x.state).sort(),['new','pending']);
 await store.complete('concurrent',{type:'text',text:'verified'});
 assert.deepEqual(await store.claim('concurrent'),{state:'ready',reply:{type:'text',text:'verified'}});
 await store.delivered('concurrent');
 assert.equal((await store.claim('concurrent')).state,'done');
 await handleLineCommand('取消 驗證H','validation-a',env,now);
 assert.equal((await sql`SELECT count(*) AS n FROM boss_kills`)[0].n,0);
 console.log('PASS: real D1 SQL, HALF/time, group isolation, admin, JSON, concurrent claims and delivery markers.');
 console.log('No production data or LINE credentials were used.');
} finally {
 for(const id of ids){await api('/'+id,undefined,'DELETE');console.log('Disposable validation database removed.');}
}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanEvents,INDEX_SQL} from './retention-core.mjs';
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database`;
async function api(path='',body,method=body?'POST':'GET'){
 const response=await fetch(root+path,{method,headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok||!data.success)throw Error('Remote validation API failure');return data.result;
}
let id;
try{
 id=(await api('',{name:'hit2-retention-test-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT})).uuid;
 const query=async(sql,params=[])=>{const result=(await api('/'+id+'/query',{sql,params}))[0];if(!result.success)throw Error('D1 query failed');return result;};
 for(const sql of readFileSync('d1/0001_core.sql','utf8').split(';').filter(s=>s.trim()))await query(sql);
 for(const sql of INDEX_SQL)await query(sql);
 const now=Date.now(),ago=d=>new Date(now-d*86400000).toISOString();
 for(const [event,delivered,reply] of [['old',ago(15),'old reply'],['compact',ago(2),'large reply'],['fresh',ago(.1),'fresh reply'],['pending',null,null],['failed',null,'retry reply']])await query('INSERT INTO staging_line_events(event_id,created_at,delivered_at,reply) VALUES(?,?,?,?)',[event,ago(20),delivered,reply]);
 await query("INSERT INTO boss_types VALUES('test','test',60)");
 const result=await cleanEvents(query,{now,batchSize:1,writeBudget:100});
 assert.equal(result.deleted,1);assert.equal(result.compacted,1);
 const records=(await query('SELECT event_id,reply,delivered_at FROM staging_line_events ORDER BY event_id')).results;
 assert.deepEqual(records.map(r=>r.event_id),['compact','failed','fresh','pending']);
 assert.equal(records.find(r=>r.event_id==='compact').reply,null);
 assert.equal(records.find(r=>r.event_id==='failed').reply,'retry reply');
 assert.equal(records.find(r=>r.event_id==='fresh').reply,'fresh reply');
 assert.equal((await query('SELECT count(*) AS n FROM boss_types')).results[0].n,1);
 const repeat=await cleanEvents(query,{now});assert.equal(repeat.deleted+repeat.compacted,0);
 console.log('PASS: real D1 retention deletion/compaction, pending preservation, indexes, write accounting and idempotence.');
 console.log(JSON.stringify({synthetic_cleanup:result}));
}finally{if(id){await api('/'+id,undefined,'DELETE');console.log('Removed synthetic retention test database.');}}

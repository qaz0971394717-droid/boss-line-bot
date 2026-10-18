import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionWorker} from '../src/production.js';
const hex=b=>Buffer.from(b).toString('hex');
test('production Discord KB requires a valid signature and only reads its fixed group',async()=>{
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const group='C'+'a'.repeat(32);let reads=0;
 const env={PRODUCTION_MODE:'true',ENABLE_DISCORD_KB:'true',DATABASE_BACKEND:'d1',DISCORD_PUBLIC_KEY:hex(await crypto.subtle.exportKey('raw',pair.publicKey)),DISCORD_KB_LINE_CHAT_ID:group,BOSS_DB:{prepare(sql){assert.match(sql,/WHERE chat_id = \?/);return {bind(id){assert.equal(id,group);return {async all(){reads++;return {success:true,results:[]};}};}};}}};
 const worker=createProductionWorker();
 async function req(data,bad=false){const body=JSON.stringify(data),stamp=String(Math.floor(Date.now()/1000));const signature=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(stamp+body)));return new Request('https://bot/discord/interactions',{method:'POST',headers:{'x-signature-timestamp':stamp,'x-signature-ed25519':bad?'0'.repeat(128):signature},body});}
 assert.deepEqual(await (await worker.fetch(await req({type:1}),env)).json(),{type:1});assert.equal(reads,0);
 assert.equal((await worker.fetch(await req({type:2,data:{name:'kb'}},true),env)).status,401);assert.equal(reads,0);
 const result=await (await worker.fetch(await req({type:2,data:{name:'kb',options:[{name:'group',value:'another'}]}}),env)).json();assert.equal(result.type,4);assert.equal(reads,1);assert.deepEqual(result.data.allowed_mentions,{parse:[]});
 const missing={...env};delete missing.DISCORD_PUBLIC_KEY;
 assert.equal((await worker.fetch(await req({type:1}),missing)).status,503);
 assert.equal((await (await worker.fetch(new Request('https://bot/'),missing)).json()).discord_kb_enabled,false);
});

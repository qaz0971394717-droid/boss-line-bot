import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/index.js';
test('OAuth public pages disclose actual data use without reading private data or contacting services',async()=>{
 const blocked=new Proxy({},{get(){throw Error('Public page accessed private data');}});
 const worker=createWorker({fetcher(){throw Error('Public page requested network');}});
 for(const path of ['/about','/privacy','/terms']){
  const r=await worker.fetch(new Request('https://memo.test'+path),blocked);assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/text\/html/);const html=await r.text();assert.match(html,/href="\/privacy"/);assert.match(html,/備忘錄/);assert.doesNotMatch(html,/<script|弘哲|@gmail|access_token|refresh_token/);
  const head=await worker.fetch(new Request('https://memo.test'+path,{method:'HEAD'}),blocked);assert.equal(await head.text(),'');
  assert.equal((await worker.fetch(new Request('https://memo.test'+path,{method:'POST'}),blocked)).status,405);
 }
 const r=await worker.fetch(new Request('https://memo.test/privacy'),blocked);const html=await r.text();assert.match(html,/Cloudflare D1/);assert.match(html,/Limited Use/);assert.match(html,/30 天/);
});

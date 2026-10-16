import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationGate} from '../src/migration.js';
test('snapshot route is disabled normally and requires a secret during maintenance',async()=>{
 const req=(method='POST',key='wrong')=>new Request('https://worker.test/__migration/snapshot',{method,headers:{authorization:'Bearer '+key}});
 assert.equal(await migrationGate(req(),{}),null);
 const env={MIGRATION_MODE:'true',MIGRATION_KEY:'secure',STAGING_DATABASE_URL:'source-only'};
 assert.equal((await migrationGate(req(),env)).status,404);
 assert.equal((await migrationGate(req('GET','secure'),env)).status,404);
 assert.equal((await migrationGate(new Request('https://worker.test/callback',{method:'POST'}),env)).status,503);
 let called=false;
 const result=await migrationGate(req('POST','secure'),env,{sourceFactory:url=>{
  assert.equal(url,'source-only');return {query:async text=>{assert.match(text,/^SELECT json_build_object/);assert.doesNotMatch(text,/DELETE|INSERT|UPDATE/);called=true;return [{snapshot:{boss_types:[]}}];}};
 }});
 assert.equal(called,true);assert.equal(result.headers.get('cache-control'),'no-store');assert.deepEqual(await result.json(),{boss_types:[]});
});

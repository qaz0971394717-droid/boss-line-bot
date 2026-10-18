import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {processAdminCommand} from '../src/admin.js';
import {createSql} from '../src/database.js';
import {shouldProcessCommand} from '../src/command-filter.js';
test('administrator challenge belongs to its actor and other group members cannot consume it',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../d1/0001_core.sql',import.meta.url),'utf8'));
 const env={STAGING_MODE:'true',ENABLE_STAGING_ADMIN:'true',ENABLE_ADMIN_ACTOR_GUARD:'true',ADMIN_PASSWORD:'secret',DATABASE_BACKEND:'d1',BOSS_DB:{prepare(query){return {bind(...args){return {async all(){return {success:true,results:db.prepare(query).all(...args)};}};}};}}};
 const sql=createSql(env),now=new Date('2026-10-18T02:00:00Z');
 const run=(text,userId,date=now)=>processAdminCommand(text,'g',env,sql,date,{userId});
 try{
 assert.match((await run('新增王 王H 60',undefined)).text,/身分/);
 await run('新增王 王H 60','a');
 assert.equal(await shouldProcessCommand('secret','g',env,{userId:'b'}),false);
 assert.equal(await shouldProcessCommand('secret','g',env,{userId:'a'}),true);
 assert.equal(await run('聊天','b'),null);assert.equal(await run('KB','b'),null);
 assert.match((await run('新增王 王B 60','b')).text,/有人/);
 assert.match((await run('secret','a')).text,/成功/);
 assert.equal(db.prepare('SELECT count(*) n FROM boss_types').get().n,1);
 assert.equal(await run('secret','a'),null);
 await run('修改王 王H 120','a');assert.match((await run('bad','a')).text,/錯誤/);
 assert.equal(db.prepare('SELECT minutes FROM boss_types').get().minutes,60);
 await run('修改王 王H 120','a');assert.match((await run('secret','a',new Date(now.getTime()+61000))).text,/逾時/);
 assert.equal(db.prepare('SELECT minutes FROM boss_types').get().minutes,60);
 }finally{db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {cleanupMemo} from '../src/cleanup.js';
import {createWorker} from '../src/index.js';
import {runCommand} from '../src/commands.js';
const owner='U'+'1'.repeat(32),other='U'+'2'.repeat(32),now=new Date('2026-10-18T07:49:24Z');
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const binding={prepare(sql){return {bind(...params){return {async all(){return {success:true,results:db.prepare(sql).all(...params)};},async first(){return db.prepare(sql).get(...params);},async run(){return db.prepare(sql).run(...params);}};}};}};return {db,binding,env:{AUTO_CLEANUP_MEMO:'true',OWNER_LINE_USER_ID:owner,MEMO_DB:binding}};}
test('hourly cleanup observes 24h boundaries, owner and item type while preserving Google data',async()=>{
 const {db,env}=fixture();try{
 db.exec('CREATE TABLE memo_calendar_events(item_id INTEGER PRIMARY KEY,calendar_id TEXT,event_id TEXT,state TEXT)');
 const before='2026-10-17T07:49:24Z',recent='2026-10-17T07:49:25Z',future='2026-10-19T00:00:00Z';
 const insert=db.prepare('INSERT INTO memo_items(id,owner_id,kind,content,due_at,status,completed_at,created_at,updated_at,source_event) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const [id,who,kind,due,status,completed] of [[1,owner,'task',null,'done',before],[2,owner,'task',null,'done',recent],[3,owner,'reminder',before,'pending',null],[4,owner,'reminder',recent,'pending',null],[5,owner,'note',null,'pending',null],[6,owner,'task',null,'pending',null],[7,owner,'reminder',future,'pending',null],[8,other,'reminder',before,'pending',null],[9,owner,'reminder','invalid','pending',null],[10,owner,'note',null,'done',before]])insert.run(id,who,kind,'content',due,status,completed,before,now.toISOString(),String(id));
 db.exec("INSERT INTO memo_calendar_events VALUES(3,'calendar','event','created')");const calendar=db.prepare('SELECT * FROM memo_calendar_events').all();
 assert.deepEqual(await cleanupMemo(env,now),{removed:2,enabled:true});
 assert.deepEqual(db.prepare('SELECT id FROM memo_items WHERE deleted_at IS NOT NULL ORDER BY id').all().map(r=>r.id),[1,3]);
 assert.deepEqual(db.prepare('SELECT * FROM memo_calendar_events').all(),calendar);
 assert.equal((await cleanupMemo(env,now)).removed,0);
 await createWorker({fetcher(){throw Error('No network allowed');}}).scheduled({scheduledTime:now.getTime()},env);
 assert.deepEqual(await cleanupMemo({AUTO_CLEANUP_MEMO:'false'}),{removed:0,enabled:false});
 }finally{db.close();}
});
test('repeated completion keeps original timestamp; reopening and completing starts a new 24h window',async()=>{
 const {db,binding}=fixture();try{
 db.exec(`INSERT INTO memo_items(owner_id,kind,content,created_at,updated_at,source_event) VALUES('${owner}','task','task','2026-10-16T00:00:00Z','2026-10-16T00:00:00Z','seed')`);
 const run=(input,stamp)=>runCommand(input,{db:binding,owner,eventId:'command',now:new Date(stamp)});
 await run('完成 1','2026-10-17T07:00:00Z');await run('完成 1','2026-10-18T07:00:00Z');assert.equal(db.prepare('SELECT completed_at FROM memo_items').get().completed_at,'2026-10-17T07:00:00.000Z');
 await run('取消完成 1','2026-10-18T07:01:00Z');assert.equal(db.prepare('SELECT completed_at FROM memo_items').get().completed_at,null);
 await run('完成 1','2026-10-18T07:02:00Z');assert.equal(db.prepare('SELECT completed_at FROM memo_items').get().completed_at,'2026-10-18T07:02:00.000Z');
 }finally{db.close();}
});

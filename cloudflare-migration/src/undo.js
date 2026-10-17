// D1 batches make each mutation and its undo snapshot one transaction.
export const UNDO_SCHEMA=[
 'CREATE TABLE IF NOT EXISTS boss_revisions(chat_id TEXT NOT NULL,boss_key TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(chat_id,boss_key))',
 ...['INSERT','UPDATE','DELETE'].map(action=>`CREATE TRIGGER IF NOT EXISTS undo_revision_${action.toLowerCase()} AFTER ${action} ON boss_kills BEGIN INSERT INTO boss_revisions(chat_id,boss_key,version) VALUES(${action==='DELETE'?'OLD':'NEW'}.chat_id,${action==='DELETE'?'OLD':'NEW'}.boss_key,1) ON CONFLICT(chat_id,boss_key) DO UPDATE SET version=version+1; END`),
 'CREATE TABLE IF NOT EXISTS undo_entries(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,chat_id TEXT NOT NULL,user_id TEXT NOT NULL,boss_key TEXT NOT NULL,before_json TEXT,after_version INTEGER,expires_at INTEGER NOT NULL)',
 'CREATE INDEX IF NOT EXISTS undo_actor ON undo_entries(chat_id,user_id,operation_id)',
 'CREATE TABLE IF NOT EXISTS undo_attempts(id TEXT PRIMARY KEY)'
];
const snapshot="json_object('boss_name',boss_name,'kill_time',kill_time,'respawn_time',respawn_time,'last_event_ms',last_event_ms)";
export function undoEnvironment(env,command,chat,user){
 if(env.ENABLE_UNDO!=='true'||!user||!env.BOSS_DB?.batch)return env;
 const parts=command.trim().split(/\s+/),kind=parts[0].toUpperCase();
 if(!['K','KBKILL','取消','修改出生'].includes(kind))return env;
 const op=crypto.randomUUID(),db=env.BOSS_DB,guard={};
 return {...env,UNDO_OPERATION_ID:op,UNDO_GUARD:guard,BOSS_DB:{prepare(query){
  const original=db.prepare(query);
  return {bind(...params){const bound=original.bind(...params);
   return {async all(){
    if(!/^(INSERT INTO|UPDATE|DELETE FROM) boss_kills\b/i.test(query.trim()))return bound.all();
    const key=kind==='取消'?String(params[1]).toLowerCase():String(parts.slice(1).join(' ').split(/\s+/)[0]).toLowerCase();
    let mutation=bound;
    if(guard.expectedRevision!==undefined&&['K','KBKILL'].includes(kind)){
     const condition='COALESCE((SELECT version FROM boss_revisions WHERE chat_id=? AND boss_key=?),0)=?';
     let guarded=query;
     if(/^INSERT/i.test(query))guarded=query.replace(/VALUES\(([^)]*)\)/i,(_,values)=>'SELECT '+values+' WHERE '+condition);
     else guarded=query.replace(/ RETURNING /i,' AND '+condition+' RETURNING ');
     mutation=db.prepare(guarded).bind(...params,chat,key,guard.expectedRevision);
    }
    const id=crypto.randomUUID(),expiry=Date.now()+600000;
    const q=(s,...p)=>db.prepare(s).bind(...p);
    const result=await db.batch([
     q(`INSERT INTO undo_entries(id,operation_id,chat_id,user_id,boss_key,before_json,expires_at) VALUES(?,?,?,?,?,(SELECT ${snapshot} FROM boss_kills WHERE chat_id=? AND boss_key=?),?)`,id,op,chat,user,key,chat,key,expiry),
     mutation,
     q('UPDATE undo_entries SET after_version=COALESCE((SELECT version FROM boss_revisions WHERE chat_id=? AND boss_key=?),0) WHERE id=? AND changes()>0',chat,key,id),
     q('DELETE FROM undo_entries WHERE id=? AND after_version IS NULL',id),
     q('DELETE FROM undo_entries WHERE chat_id=? AND user_id=? AND operation_id!=? AND EXISTS(SELECT 1 FROM undo_entries WHERE id=?)',chat,user,op,id)
    ]);
    return result[1];
   }};
  }};
 },batch:db.batch.bind(db)}};
}
export async function undoLast(env,chat,user,expectedOperation){
 const msg=text=>({type:'text',text});
 if(env.ENABLE_UNDO!=='true')return msg('復原功能尚未啟用。');
 if(!user)return msg('無法確認操作身分，未復原。');
 const db=env.BOSS_DB,q=(s,...p)=>db.prepare(s).bind(...p);
 const rows=(await q('SELECT * FROM undo_entries WHERE chat_id=? AND user_id=? ORDER BY expires_at DESC',chat,user).all()).results;
 if(!rows.length)return msg('目前沒有可復原的操作。');
 if(expectedOperation&&rows[0].operation_id!==expectedOperation)return msg('這是舊操作的按鈕，未復原目前的新操作。');
 const op=rows[0].operation_id,entries=rows.filter(r=>r.operation_id===op);
 if(entries.some(r=>r.expires_at<=Date.now())){await q('DELETE FROM undo_entries WHERE chat_id=? AND user_id=?',chat,user).run();return msg('已超過 10 分鐘，無法復原。');}
 const attempt=crypto.randomUUID();
 const queries=[q(`INSERT INTO undo_attempts(id) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM undo_entries e WHERE e.chat_id=? AND e.user_id=? AND e.operation_id=? AND (e.expires_at<=? OR e.after_version!=COALESCE((SELECT version FROM boss_revisions r WHERE r.chat_id=e.chat_id AND r.boss_key=e.boss_key),0) OR (e.before_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM boss_types b WHERE b.boss_key=e.boss_key)))) AND EXISTS(SELECT 1 FROM undo_entries WHERE chat_id=? AND user_id=? AND operation_id=?)`,attempt,chat,user,op,Date.now(),chat,user,op)];
 for(const entry of entries){
  if(entry.before_json){const old=JSON.parse(entry.before_json);queries.push(q('INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time,last_event_ms) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM undo_attempts WHERE id=?) ON CONFLICT(chat_id,boss_key) DO UPDATE SET boss_name=excluded.boss_name,kill_time=excluded.kill_time,respawn_time=excluded.respawn_time,last_event_ms=excluded.last_event_ms',chat,entry.boss_key,old.boss_name,old.kill_time,old.respawn_time,Date.now(),attempt));}
  else queries.push(q('DELETE FROM boss_kills WHERE chat_id=? AND boss_key=? AND EXISTS(SELECT 1 FROM undo_attempts WHERE id=?)',chat,entry.boss_key,attempt));
 }
 queries.push(q('DELETE FROM undo_entries WHERE chat_id=? AND user_id=? AND operation_id=? AND EXISTS(SELECT 1 FROM undo_attempts WHERE id=?)',chat,user,op,attempt));
 queries.push(q('DELETE FROM undo_attempts WHERE id=? RETURNING id',attempt));
 const result=await db.batch(queries);
 return msg(result.at(-1).results.length?`✅ 已復原你上一筆操作（${entries.length} 隻王）。`:'紀錄已有後續變更，未復原。');
}

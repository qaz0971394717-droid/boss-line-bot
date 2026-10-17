export const OVERWRITE_SCHEMA='CREATE TABLE IF NOT EXISTS overwrite_confirmations(token TEXT PRIMARY KEY,chat_id TEXT NOT NULL,user_id TEXT NOT NULL,command TEXT NOT NULL,expected_version INTEGER NOT NULL,requested_at TEXT NOT NULL,expires_at INTEGER NOT NULL,UNIQUE(chat_id,user_id))';
const message=text=>({type:'text',text});
export async function checkOverwrite(command,chat,env,now,context){
 if(env.ENABLE_OVERWRITE_GUARD!=='true')return null;
 const parts=command.trim().split(/\s+/);if(!['K','KBKILL'].includes(parts[0].toUpperCase())||parts.length<2)return null;
 if(!context.userId)return message('無法確認操作身分，未更新紀錄。');
 const key=parts[0].toUpperCase()==='KBKILL'?parts.slice(1).join(' ').toLowerCase():parts[1].toLowerCase();
 const q=(s,...p)=>env.BOSS_DB.prepare(s).bind(...p);
 const rows=(await q('SELECT k.boss_name,k.last_event_ms,COALESCE(r.version,0) version FROM boss_kills k LEFT JOIN boss_revisions r ON r.chat_id=k.chat_id AND r.boss_key=k.boss_key WHERE k.chat_id=? AND k.boss_key=?',chat,key).all()).results;
 const row=rows[0],version=row?.version??((await q('SELECT version FROM boss_revisions WHERE chat_id=? AND boss_key=?',chat,key).all()).results[0]?.version||0);
 if(!env.UNDO_GUARD)return message('報王保護設定未完成，未更新紀錄。');
 if(context.overwriteVersion!==undefined){if(version!==context.overwriteVersion)return message('紀錄又有更新，已取消覆蓋。請重新報王。');env.UNDO_GUARD.expectedRevision=version;return null;}
 if(context.eventTimestamp<Number(row?.last_event_ms||0))return message('已有較新的紀錄，未覆蓋。');
 env.UNDO_GUARD.expectedRevision=version;
 if(!row||Date.now()-Number(row.last_event_ms)>60000)return null;
 const owners=(await q('SELECT user_id FROM undo_entries WHERE chat_id=? AND boss_key=? AND after_version=? LIMIT 1',chat,key,version).all()).results;
 if(owners[0]?.user_id===context.userId)return null;
 const token=crypto.randomUUID();
 await q('INSERT INTO overwrite_confirmations(token,chat_id,user_id,command,expected_version,requested_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET token=excluded.token,command=excluded.command,expected_version=excluded.expected_version,requested_at=excluded.requested_at,expires_at=excluded.expires_at',token,chat,context.userId,command,version,now.toISOString(),Date.now()+60000).all();
 return {type:'text',text:`${row.boss_name} 剛有人報過，要覆蓋嗎？\n僅你可確認，60 秒內有效。`,quickReply:{items:[{type:'action',action:{type:'postback',label:'確認覆蓋',data:'overwrite:confirm:'+token,displayText:'確認覆蓋'}},{type:'action',action:{type:'postback',label:'保留原紀錄',data:'overwrite:cancel:'+token,displayText:'保留原紀錄'}}]}};
}
export async function consumeOverwrite(command,chat,env,user){
 if(!/^(確認覆蓋|取消覆蓋) [a-f0-9-]{36}$/.test(command))return null;
 if(env.ENABLE_OVERWRITE_GUARD!=='true'||!user)return {reply:message('覆蓋確認目前無效。')};
 const token=command.split(' ')[1];
 const result=await env.BOSS_DB.prepare('DELETE FROM overwrite_confirmations WHERE token=? AND chat_id=? AND user_id=? RETURNING *').bind(token,chat,user).all();
 const row=result.results[0];if(!row)return {reply:message('這項確認不屬於你、已取消或已使用。')};
 if(command.startsWith('取消'))return {reply:message('已保留原紀錄。')};
 if(row.expires_at<=Date.now())return {reply:message('確認已逾時，未覆蓋。')};
 return {row};
}

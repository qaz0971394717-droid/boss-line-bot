// LINE memo retention only: no Google API, calendar mutation or LINE push.
export async function cleanupMemo(env,now=new Date()){
 if(env.AUTO_CLEANUP_MEMO!=='true')return {removed:0,enabled:false};
 if(!/^U[a-f0-9]{32}$/i.test(env.OWNER_LINE_USER_ID||'')||!env.MEMO_DB?.prepare)throw Error('Memo cleanup owner or database missing');
 if(!Number.isFinite(now.getTime()))throw Error('Invalid cleanup clock');
 const stamp=now.toISOString(),cutoff=new Date(now.getTime()-86400000).toISOString();
 const result=await env.MEMO_DB.prepare(`UPDATE memo_items SET deleted_at=?,updated_at=?
 WHERE owner_id=? AND deleted_at IS NULL AND id IN (
 SELECT id FROM memo_items WHERE owner_id=? AND deleted_at IS NULL AND (
 (kind IN ('task','reminder') AND status='done' AND completed_at IS NOT NULL AND julianday(completed_at)<=julianday(?))
 OR (kind='reminder' AND due_at IS NOT NULL AND julianday(due_at)<=julianday(?))
 ) ORDER BY id LIMIT 250) RETURNING id`).bind(stamp,stamp,env.OWNER_LINE_USER_ID,env.OWNER_LINE_USER_ID,cutoff,cutoff).all();
 if(!result.success)throw Error('Memo automatic cleanup failed');
 return {removed:result.results.length,enabled:true};
}

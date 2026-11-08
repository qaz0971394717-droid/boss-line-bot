import {createGroupAdminFlex} from './group-admin-flex.js';
const response = text => ({type:'text',text});

export const GROUP_ACCESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS group_access (
    chat_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','denied')),
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT,
    group_name TEXT,
    name_checked_at TEXT,
    paused INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS group_access_challenges (
    user_id TEXT PRIMARY KEY,
    target_chat_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS group_access_action_challenges (
    user_id TEXT PRIMARY KEY,
    target_chat_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('revoke')),
    expires_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS group_access_status ON group_access(status,requested_at)'
];

const NAME_REFRESH_MS=7*86400000,NAME_RETRY_MS=86400000;
// Best effort: store the LINE group name so the admin card is readable. Never throws.
export async function rememberGroupName(chatId,sourceType,env,sql,fetcher,now=new Date()){
  try{
    if(sourceType!=='group')return;
    const rows=await sql`SELECT group_name,name_checked_at FROM group_access WHERE chat_id=${chatId}`;
    if(!rows.length)return;
    const age=rows[0].name_checked_at?now.getTime()-new Date(rows[0].name_checked_at).getTime():Infinity;
    if(age<(rows[0].group_name?NAME_REFRESH_MS:NAME_RETRY_MS))return;
    let name=null;
    try{
      const res=await fetcher(`https://api.line.me/v2/bot/group/${chatId}/summary`,{headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`},signal:AbortSignal.timeout(3000)});
      if(res.ok)name=String((await res.json())?.groupName||'').slice(0,60)||null;
    }catch{}
    await sql`UPDATE group_access SET group_name=${name||rows[0].group_name||null},name_checked_at=${now.toISOString()} WHERE chat_id=${chatId}`;
  }catch{}
}

// Private chats with the production bot: anyone but the owner must be approved in group_access
// (chat_id = LINE user id). First contact registers a pending request with the display name.
export async function privateChatAccess(userId,env,sql,fetcher,now=new Date()){
  try{
    if(!userId)return false;
    if(userId===env.PRIVATE_CHAT_ONLY_USER_ID)return true;
    const rows=await sql`SELECT status FROM group_access WHERE chat_id=${userId}`;
    if(rows[0]?.status==='approved')return true;
    if(!rows.length){
      let name=null;
      try{
        const res=await fetcher(`https://api.line.me/v2/bot/profile/${userId}`,{headers:{Authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`},signal:AbortSignal.timeout(2000)});
        if(res.ok)name=String((await res.json())?.displayName||'').slice(0,60)||null;
      }catch{}
      await sql`INSERT INTO group_access(chat_id,status,requested_at,group_name,name_checked_at) VALUES(${userId},'pending',${now.toISOString()},${name},${now.toISOString()}) ON CONFLICT(chat_id) DO NOTHING`;
    }
    return false;
  }catch{return false;}
}

export const isGroupAccessCommand = input => {
  const text=input.trim();
  return text==='申請使用'||text==='授權群組數'||text==='群組管理'||text==='移除待核准'||/^(?:撤銷群組授權|移除申請|暫停群組|恢復群組)\s+[CU][a-f0-9]{32}$/i.test(text)||/^授權群組\s+\S+$/.test(text);
};

export async function processGroupAccessCommand(input,chatId,env,sql,now=new Date(),context={},managementSql=null){
  const text=input.trim();
  const dismiss=text.match(/^移除申請\s+([CU][a-f0-9]{32})$/i);
  const pause=text.match(/^(暫停群組|恢復群組)\s+(C[a-f0-9]{32})$/i);
  const stagingOnlyCommand=text==='授權群組數'||text==='群組管理'||text==='移除待核准'||Boolean(dismiss)||Boolean(pause)||/^撤銷群組授權\s+[CU][a-f0-9]{32}$/i.test(text);
  if(stagingOnlyCommand&&env.ENABLE_STAGING_GROUP_ACCESS_ADMIN!=='true')return null;
  const privateChat=context.sourceType==='user'&&context.userId&&chatId===context.userId;
  if(text==='授權群組數'){
    if(!privateChat)return response('🔒 請私訊 HIT2 測試+異常提醒 查詢授權群組數。');
    if(!managementSql)return response('❌ 正式授權資料庫尚未連線，無法查詢。');
    const rows=await managementSql`SELECT count(*) AS count FROM group_access WHERE status='approved' AND chat_id NOT LIKE 'U%'`;
    return response(`📊 正式版目前已授權：${Number(rows[0]?.count||0)} 個群組。`);
  }
  if(text==='群組管理'||text==='移除待核准'||dismiss||pause){
    if(!privateChat)return response('🔒 請私訊 HIT2 測試+異常提醒 使用群組管理。');
    if(!managementSql)return response('❌ 正式授權資料庫尚未連線，無法查詢。');
    // Dropping a pending request only deletes the request row; it never touches approved groups.
    if(dismiss)await managementSql`DELETE FROM group_access WHERE chat_id=${dismiss[1]} AND status='pending'`;
    else if(text==='移除待核准')await managementSql`DELETE FROM group_access WHERE status='pending'`;
    // Pausing only mutes the group; approval is kept, so it is reversible and needs no password.
    else if(pause)await managementSql`UPDATE group_access SET paused=${pause[1]==='暫停群組'?1:0} WHERE chat_id=${pause[2]} AND status='approved'`;
    let rows;
    try{rows=await managementSql`SELECT chat_id,status,requested_at,approved_at,approved_by,group_name,paused FROM group_access WHERE status IN ('approved','pending') ORDER BY status,COALESCE(approved_at,requested_at) DESC`;}
    catch{
      // Older production schema: columns are added when the production worker is released.
      try{rows=await managementSql`SELECT chat_id,status,requested_at,approved_at,approved_by,group_name FROM group_access WHERE status IN ('approved','pending') ORDER BY status,COALESCE(approved_at,requested_at) DESC`;}
      catch{rows=await managementSql`SELECT chat_id,status,requested_at,approved_at,approved_by FROM group_access WHERE status IN ('approved','pending') ORDER BY status,COALESCE(approved_at,requested_at) DESC`;}
    }
    return createGroupAdminFlex(rows);
  }
  const revoke=text.match(/^撤銷群組授權\s+([CU][a-f0-9]{32})$/i);
  if(revoke){
    if(!privateChat||!context.userId)return response('🔒 請在 HIT2 測試+異常提醒 的 1 對 1 私訊中撤銷群組授權。');
    if(!env.ADMIN_PASSWORD)return response('❌ 管理密碼尚未設定，無法移除授權。');
    const target=revoke[1];
    if(!managementSql)return response('❌ 正式授權資料庫尚未連線，無法移除授權。');
    const rows=await managementSql`SELECT status FROM group_access WHERE chat_id=${target}`;
    if(rows[0]?.status!=='approved')return response('ℹ️ 找不到這個已授權群組，或它已經停用。');
    await sql`INSERT INTO group_access_action_challenges(user_id,target_chat_id,action,expires_at)
      VALUES(${context.userId},${target},'revoke',${new Date(now.getTime()+60000).toISOString()})
      ON CONFLICT(user_id) DO UPDATE SET target_chat_id=EXCLUDED.target_chat_id,action=EXCLUDED.action,expires_at=EXCLUDED.expires_at`;
    return response(`🔐 將移除群組 ${target} 的授權。請在 60 秒內於此私訊輸入管理密碼確認。`);
  }
  if(privateChat&&context.userId){
   const actionChallenge=await sql`SELECT target_chat_id,action,expires_at FROM group_access_action_challenges WHERE user_id=${context.userId}`;
   if(actionChallenge.length){
    await sql`DELETE FROM group_access_action_challenges WHERE user_id=${context.userId}`;
    const pending=actionChallenge[0];
    if(new Date(pending.expires_at).getTime()<=now.getTime())return response('⏰ 操作驗證已逾時，請重新輸入「撤銷群組授權 群組ID」。');
    const enc=new TextEncoder();
    const [expected,actual]=await Promise.all([
      crypto.subtle.digest('SHA-256',enc.encode(env.ADMIN_PASSWORD||'')),
      crypto.subtle.digest('SHA-256',enc.encode(text))
    ]);
    const a=new Uint8Array(expected),b=new Uint8Array(actual);let diff=0;
    for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
    if(!env.ADMIN_PASSWORD||diff!==0)return response('❌ 管理密碼錯誤，此次操作已取消。');
    if(!managementSql)return response('❌ 正式授權資料庫尚未連線，未移除授權。');
    const changed=await managementSql`UPDATE group_access SET status='denied' WHERE chat_id=${pending.target_chat_id} AND status='approved' RETURNING chat_id`;
    return changed.length
      ? response(`✅ 已移除群組 ${pending.target_chat_id} 的授權。該群現在無法使用 BOSS Bot。`)
      : response('ℹ️ 該群組已沒有有效授權。');
   }
  }
  const approval=text.match(/^授權群組\s+([CU][a-f0-9]{32})$/i);
  if(approval){
    if(!privateChat)return response('🔒 請私訊 BOSS 機器人進行群組授權。');
    if(!env.ADMIN_PASSWORD)return response('❌ 管理密碼尚未設定，無法授權群組。');
    await sql`INSERT INTO group_access_challenges(user_id,target_chat_id,expires_at)
      VALUES(${context.userId},${approval[1]},${new Date(now.getTime()+60000).toISOString()})
      ON CONFLICT(user_id) DO UPDATE SET target_chat_id=EXCLUDED.target_chat_id,expires_at=EXCLUDED.expires_at`;
    return response('🔐 請在 60 秒內私訊輸入管理密碼以授權此群組。');
  }
  if(!privateChat||!context.userId)return null;
  const pending=await sql`SELECT target_chat_id,expires_at FROM group_access_challenges WHERE user_id=${context.userId}`;
  if(!pending.length)return null;
  await sql`DELETE FROM group_access_challenges WHERE user_id=${context.userId}`;
  if(new Date(pending[0].expires_at).getTime()<=now.getTime())return response('⏰ 授權驗證已逾時，請重新輸入「授權群組 群組ID」。');
  const enc=new TextEncoder();
  const [expected,actual]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(env.ADMIN_PASSWORD)),
    crypto.subtle.digest('SHA-256',enc.encode(text))
  ]);
  const a=new Uint8Array(expected),b=new Uint8Array(actual);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff!==0)return response('❌ 管理密碼錯誤，此次授權已取消。');
  const approve=db=>db`UPDATE group_access SET status='approved',approved_at=${now.toISOString()},approved_by=${context.userId}
    WHERE chat_id=${pending[0].target_chat_id} AND status='pending' RETURNING chat_id`;
  // The staging bot's private chat is the admin console: approve production requests first,
  // then fall back to this bot's own database for groups that applied to the staging bot.
  const adminConsole=env.ENABLE_STAGING_GROUP_ACCESS_ADMIN==='true'&&managementSql;
  let changed=adminConsole?await approve(managementSql):[];
  if(!changed.length)changed=await approve(sql);
  return changed.length
    ? response(`✅ 已授權群組 ${pending[0].target_chat_id}，現在可以開始使用。`)
    : response('⚠️ 找不到這個群組的待審申請，請先在該群輸入「申請使用」。');
}

export async function groupAccessReply(input,chatId,sourceType,env,sql,now=new Date()){
  if(!['group','room'].includes(sourceType))return null;
  const text=input.trim();
  const rows=await sql`SELECT status FROM group_access WHERE chat_id=${chatId}`;
  if(rows[0]?.status==='approved')return text==='申請使用'?response('✅ 本群已授權，可以正常使用 BOSS Bot。'):null;
  if(!rows.length){
    // Preserve any older group if it was not present in the first backfill snapshot.
    const legacy=await sql`SELECT chat_id FROM chat_settings WHERE chat_id=${chatId}`;
    if(legacy.length){
      await sql`INSERT INTO group_access(chat_id,status,requested_at,approved_at,approved_by)
        VALUES(${chatId},'approved',${now.toISOString()},${now.toISOString()},'grandfathered') ON CONFLICT(chat_id) DO NOTHING`;
      return null;
    }
  }
  if(!rows.length||rows[0]?.status!=='pending'){
    await sql`INSERT INTO group_access(chat_id,status,requested_at) VALUES(${chatId},'pending',${now.toISOString()})
      ON CONFLICT(chat_id) DO UPDATE SET status='pending',requested_at=excluded.requested_at WHERE group_access.status='denied'`;
  }
  if(text!=='申請使用'&&text!=='授權群組數'&&text!=='群組管理'&&!/^撤銷群組授權(?:\s|$)/i.test(text)&&!/^(?:KB|王|BOSS|測試|TEST|HELP|指令|進階指令|管理指令|指令文字|進階指令文字|管理指令文字|群組ID|GROUPID|HALF(?:\s+(?:ON|OFF))?|清除KB|RESTART|同步提醒|王列表|BOSS列表|K|KBKILL|取消|修改出生|新增王|批次新增王|修改王|刪除王|授權群組)(?:\s|$)/i.test(text))return null;
  return response(`🔒 本群尚未授權使用 BOSS Bot。\n請輸入「申請使用」取得群組 ID，再傳給管理者核准。\n群組 ID：${chatId}`);
}

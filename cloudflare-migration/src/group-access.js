const response = text => ({type:'text',text});

export const GROUP_ACCESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS group_access (
    chat_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','denied')),
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT
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

export const isGroupAccessCommand = input => {
  const text=input.trim();
  return text==='申請使用'||text==='授權群組數'||text==='撤銷本群授權'||/^授權群組\s+\S+$/.test(text);
};

export async function processGroupAccessCommand(input,chatId,env,sql,now=new Date(),context={}){
  const text=input.trim();
  const stagingOnlyCommand=text==='授權群組數'||text==='撤銷本群授權';
  if(stagingOnlyCommand&&env.ENABLE_STAGING_GROUP_ACCESS_ADMIN!=='true')return null;
  const privateChat=context.sourceType==='user'&&context.userId&&chatId===context.userId;
  const groupChat=['group','room'].includes(context.sourceType);
  if(text==='授權群組數'){
    if(!groupChat)return response('ℹ️ 請在已授權的群組查詢。');
    const rows=await sql`SELECT count(*) AS count FROM group_access WHERE status='approved'`;
    return response(`📊 目前已授權：${Number(rows[0]?.count||0)} 個群組。`);
  }
  if(text==='撤銷本群授權'){
    if(!groupChat||!context.userId)return response('❌ 請在群組內由管理者發起此操作。');
    if(!env.ADMIN_PASSWORD)return response('❌ 管理密碼尚未設定，無法移除授權。');
    const rows=await sql`SELECT status FROM group_access WHERE chat_id=${chatId}`;
    if(rows[0]?.status!=='approved')return response('ℹ️ 本群目前沒有有效授權。');
    await sql`INSERT INTO group_access_action_challenges(user_id,target_chat_id,action,expires_at)
      VALUES(${context.userId},${chatId},'revoke',${new Date(now.getTime()+60000).toISOString()})
      ON CONFLICT(user_id) DO UPDATE SET target_chat_id=EXCLUDED.target_chat_id,action=EXCLUDED.action,expires_at=EXCLUDED.expires_at`;
    return response('🔐 已發起移除本群授權。請在 60 秒內私訊 BOSS Bot 輸入管理密碼；密碼不會顯示在群組。');
  }
  if(privateChat&&context.userId){
   const actionChallenge=await sql`SELECT target_chat_id,action,expires_at FROM group_access_action_challenges WHERE user_id=${context.userId}`;
   if(actionChallenge.length){
    await sql`DELETE FROM group_access_action_challenges WHERE user_id=${context.userId}`;
    const pending=actionChallenge[0];
    if(new Date(pending.expires_at).getTime()<=now.getTime())return response('⏰ 操作驗證已逾時，請回群組重新輸入「撤銷本群授權」。');
    const enc=new TextEncoder();
    const [expected,actual]=await Promise.all([
      crypto.subtle.digest('SHA-256',enc.encode(env.ADMIN_PASSWORD||'')),
      crypto.subtle.digest('SHA-256',enc.encode(text))
    ]);
    const a=new Uint8Array(expected),b=new Uint8Array(actual);let diff=0;
    for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
    if(!env.ADMIN_PASSWORD||diff!==0)return response('❌ 管理密碼錯誤，此次操作已取消。');
    const changed=await sql`UPDATE group_access SET status='denied' WHERE chat_id=${pending.target_chat_id} AND status='approved' RETURNING chat_id`;
    return changed.length
      ? response(`✅ 已移除群組授權（${pending.target_chat_id}）。該群現在無法使用 BOSS Bot。`)
      : response('ℹ️ 該群組已沒有有效授權。');
   }
  }
  const approval=text.match(/^授權群組\s+(C[a-f0-9]{32})$/i);
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
  const changed=await sql`UPDATE group_access SET status='approved',approved_at=${now.toISOString()},approved_by=${context.userId}
    WHERE chat_id=${pending[0].target_chat_id} AND status='pending' RETURNING chat_id`;
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
  if(text!=='申請使用'&&text!=='授權群組數'&&text!=='撤銷本群授權'&&!/^(?:KB|王|BOSS|測試|TEST|HELP|指令|進階指令|管理指令|指令文字|進階指令文字|管理指令文字|群組ID|GROUPID|HALF(?:\s+(?:ON|OFF))?|清除KB|RESTART|同步提醒|王列表|BOSS列表|K|KBKILL|取消|修改出生|新增王|批次新增王|修改王|刪除王|授權群組)(?:\s|$)/i.test(text))return null;
  return response(`🔒 本群尚未授權使用 BOSS Bot。\n請輸入「申請使用」取得群組 ID，再傳給管理者核准。\n群組 ID：${chatId}`);
}

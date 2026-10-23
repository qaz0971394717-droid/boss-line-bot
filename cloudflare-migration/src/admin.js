import { stagingReminderRequest, cancelPayload, reminderWarning } from "./reminders.js";
// Staging-only administrator commands. No password is persisted in PostgreSQL.
export const isAdminCommand=text=>/^(新增王|批次新增王|修改王|刪除王)\s+/.test(text);
export function parseAdminCommand(text){
 const m=text.match(/^(新增王|批次新增王|修改王|刪除王)\s+(.+)$/);
 if(!m)return null;
 const kind=m[1],rest=m[2].trim();
 if(kind==="刪除王")return /^\S+$/.test(rest)?{kind,names:[rest]}:null;
 const match=rest.match(/^(.+?)\s+(\d+)$/);
 if(!match)return null;
 const minutes=Number(match[2]);
 if(!Number.isSafeInteger(minutes)||minutes<=0||minutes>525600)return null;
 const names=kind==="批次新增王"?match[1].split(/[、，,]/).map(x=>x.trim()):[match[1].trim()];
 if(!names.length||names.length>100||names.some(name=>!name||name.length>100||/\s/.test(name)))return null;
 return {kind,names,minutes};
}
const response=text=>({type:"text",text});
async function safeEqual(a,b){
 const enc=new TextEncoder();
 const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(a)),crypto.subtle.digest("SHA-256",enc.encode(b))]);
 const aa=new Uint8Array(x),bb=new Uint8Array(y);let diff=0;
 for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];
 return diff===0;
}
export async function processAdminCommand(input,chatId,env,sql,now=new Date(),context={}){
 if(env.STAGING_MODE!=="true"||env.ENABLE_STAGING_ADMIN!=="true")return isAdminCommand(input)?response("❌ 測試版管理功能尚未啟用。"):null;
 // A single DELETE ... RETURNING atomically consumes a pending challenge.
 // Each chat has at most one active challenge.
 let pending;
 if(env.ENABLE_ADMIN_ACTOR_GUARD==='true'){
  if(!context.userId)return isAdminCommand(input)?response('❌ 無法確認操作身分，請稍後再試。'):null;
  const rows=await sql`SELECT command,expires_at FROM staging_admin_challenges WHERE chat_id=${chatId}`;
  if(rows.length){
   const row=rows[0];let owner;try{owner=JSON.parse(row.command);}catch{}
   const expired=new Date(row.expires_at).getTime()<=now.getTime();
   if(!owner?.userId||expired){
    await sql`DELETE FROM staging_admin_challenges WHERE chat_id=${chatId} AND command=${row.command}`;
    if(!isAdminCommand(input))return response('⏰ 管理驗證已逾時。請重新輸入管理指令。');
   }else if(owner.userId!==context.userId){
    return isAdminCommand(input)?response('🔒 目前有人正在管理驗證，請稍後再試。'):null;
   }else{
    pending=await sql`DELETE FROM staging_admin_challenges WHERE chat_id=${chatId} AND command=${row.command} RETURNING command,expires_at`;
    if(!pending.length)return response('此次驗證已處理，請重新輸入管理指令。');
    pending[0].command=owner.command;
   }
  }
  pending??=[];
 }else pending=await sql`DELETE FROM staging_admin_challenges WHERE chat_id=${chatId} RETURNING command,expires_at`;
 if(pending.length){
  if(new Date(pending[0].expires_at).getTime()<=now.getTime())return response("⏰ 管理驗證已逾時。請重新輸入管理指令。");
  if(!env.ADMIN_PASSWORD||!await safeEqual(input,env.ADMIN_PASSWORD))return response("❌ 管理密碼錯誤。此次操作已取消。");
  const parsed=parseAdminCommand(pending[0].command);
  if(!parsed)return response("❌ 管理指令格式錯誤，請重新輸入。");
  return applyAdminAction(parsed,sql,env);
 }
 if(!isAdminCommand(input))return null;
 if(!parseAdminCommand(input))return response("❌ 管理指令格式錯誤：請檢查王名及分鐘數。");
 if(!env.ADMIN_PASSWORD)return response("❌ 測試環境尚未設定管理密碼，管理指令已停用。");
 if(env.ENABLE_ADMIN_ACTOR_GUARD==='true'){
  const inserted=await sql`INSERT INTO staging_admin_challenges(chat_id,command,expires_at) VALUES(${chatId},${JSON.stringify({command:input,userId:context.userId})},${new Date(now.getTime()+60000).toISOString()}) ON CONFLICT(chat_id) DO NOTHING RETURNING chat_id`;
  if(!inserted.length)return response('🔒 目前有人正在管理驗證，請稍後再試。');
 }else await sql`INSERT INTO staging_admin_challenges(chat_id,command,expires_at)
 VALUES(${chatId},${env.ENABLE_ADMIN_ACTOR_GUARD==='true'?JSON.stringify({command:input,userId:context.userId}):input},${new Date(now.getTime()+60000).toISOString()})
 ON CONFLICT(chat_id) DO UPDATE SET command=EXCLUDED.command,expires_at=EXCLUDED.expires_at`;
 return response("🔒 此操作需要管理權限。請在 60 秒內輸入管理密碼。");
}
export async function applyAdminAction(action,sql,env={}){
 const {kind,names,minutes}=action;
 const completed=[],rejected=[],reminderFailures=[];
 for(const name of names){
  const key=name.toLowerCase();
  if(kind==="新增王"||kind==="批次新增王"){
   const inserted=await sql`INSERT INTO boss_types(boss_key,boss_name,minutes) VALUES(${key},${name},${minutes}) ON CONFLICT(boss_key) DO NOTHING RETURNING boss_name`;
   (inserted.length?completed:rejected).push(name);
  }else if(kind==="修改王"){
   const changed=await sql`UPDATE boss_types SET minutes=${minutes} WHERE boss_key=${key} RETURNING boss_name`;
   (changed.length?completed:rejected).push(name);
  }else if(kind==="刪除王"){
   // Remove all associated kill records, then cancel reminders for EACH affected chat.
   const deleted=await sql`DELETE FROM boss_types WHERE boss_key=${key} RETURNING boss_name`;
   if(deleted.length){
    const affected=await sql`DELETE FROM boss_kills WHERE boss_key=${key} RETURNING chat_id,boss_name`;
    for(const item of affected){const result=await stagingReminderRequest(env,"/cancel",cancelPayload(item.chat_id,item.boss_name));if(reminderWarning(env,result,"取消"))reminderFailures.push(`${item.boss_name}（${item.chat_id}）`);}
    completed.push(name);
   }else rejected.push(name);
  }
 }
 return response([completed.length?`✅ ${kind}成功：${completed.join("、")}`:"",rejected.length?`⚠️ 未處理（已存在或不存在）：${rejected.join("、")}`:"",reminderFailures.length?`⚠️ 以下群組提醒取消失敗：${reminderFailures.join("、")}`:""].filter(Boolean).join("\n"));
}

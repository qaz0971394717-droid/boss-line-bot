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
export async function processAdminCommand(input,chatId,env,sql,now=new Date()){
 // A single DELETE ... RETURNING atomically consumes a pending challenge.
 // Each chat has at most one active challenge.
 const pending=await sql`DELETE FROM staging_admin_challenges WHERE chat_id=${chatId} RETURNING command,expires_at`;
 if(pending.length){
  if(new Date(pending[0].expires_at).getTime()<=now.getTime())return response("⏰ 管理驗證已逾時。請重新輸入管理指令。");
  if(!env.ADMIN_PASSWORD||!await safeEqual(input,env.ADMIN_PASSWORD))return response("❌ 管理密碼錯誤。此次操作已取消。");
  const parsed=parseAdminCommand(pending[0].command);
  if(!parsed)return response("❌ 管理指令格式錯誤，請重新輸入。");
  return applyAdminAction(parsed,sql);
 }
 if(!isAdminCommand(input))return null;
 if(!parseAdminCommand(input))return response("❌ 管理指令格式錯誤：請檢查王名及分鐘數。");
 if(!env.ADMIN_PASSWORD)return response("❌ 測試環境尚未設定管理密碼，管理指令已停用。");
 await sql`INSERT INTO staging_admin_challenges(chat_id,command,expires_at)
 VALUES(${chatId},${input},${new Date(now.getTime()+60000).toISOString()})
 ON CONFLICT(chat_id) DO UPDATE SET command=EXCLUDED.command,expires_at=EXCLUDED.expires_at`;
 return response("🔒 此操作需要管理權限。請在 60 秒內輸入管理密碼。");
}
export async function applyAdminAction(action,sql){
 const {kind,names,minutes}=action;
 const completed=[],rejected=[];
 for(const name of names){
  const key=name.toLowerCase();
  if(kind==="新增王"||kind==="批次新增王"){
   const inserted=await sql`INSERT INTO boss_types(boss_key,boss_name,minutes) VALUES(${key},${name},${minutes}) ON CONFLICT(boss_key) DO NOTHING RETURNING boss_name`;
   (inserted.length?completed:rejected).push(name);
  }else if(kind==="修改王"){
   const changed=await sql`UPDATE boss_types SET minutes=${minutes} WHERE boss_key=${key} RETURNING boss_name`;
   (changed.length?completed:rejected).push(name);
  }else if(kind==="刪除王"){
   const deleted=await sql`DELETE FROM boss_types WHERE boss_key=${key} RETURNING boss_name`;
   if(deleted.length){
    await sql`DELETE FROM boss_kills WHERE boss_key=${key}`;
    completed.push(name);
   }else rejected.push(name);
  }
 }
 return response([completed.length?`✅ ${kind}成功：${completed.join("、")}`:"",rejected.length?`⚠️ 未處理（已存在或不存在）：${rejected.join("、")}`:""].filter(Boolean).join("\n"));
}

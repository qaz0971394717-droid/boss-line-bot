import {BIRTHDAY_COMMAND,birthdayEnabled} from './birthday.js';
import {createSql} from './database.js';
export const knownCommand=text=>/^(?:申請使用|授權群組數|撤銷本群授權|同步提醒|HELP|復原|指令文字|進階指令文字|管理指令文字|指令|進階指令|管理指令|群組ID|GROUPID|測試|TEST|RESTART|清除KB|王列表|BOSS列表|KB|王|BOSS|HALF(?:\s+(?:ON|OFF))?)$/i.test(text.trim())||/^(?:授權群組|確認覆蓋|取消覆蓋|K|KBKILL|取消|修改出生|新增王|批次新增王|修改王|刪除王)\s+/i.test(text.trim());
export async function shouldProcessCommand(text,chatId,env,context){
 if(/^(?:授權群組數|撤銷本群授權)$/.test(text.trim())&&env.ENABLE_STAGING_GROUP_ACCESS_ADMIN!=='true')return false;
 if(text.trim()===BIRTHDAY_COMMAND)return birthdayEnabled(env,chatId);
 if(knownCommand(text)||(env.ENABLE_OPS_ALERTS==='true'&&text.trim()==='啟用異常通知'))return true;
 const sql=createSql(env);
 if(['是','否'].includes(text.trim())&&context.userId){
  const rows=await sql`SELECT expires_at FROM command_confirmations WHERE chat_id=${chatId} AND user_id=${context.userId}`;
  return rows.length>0;
 }
 // Retain the existing administrator password conversation. Ordinary chat has
 // at most an indexed read here; no event record or reply is written.
 let adminPending=false;
 if(env.ENABLE_STAGING_ADMIN==='true'){
  const rows=await sql`SELECT command,expires_at FROM staging_admin_challenges WHERE chat_id=${chatId}`;
  if(env.ENABLE_ADMIN_ACTOR_GUARD==='true'){
   try{adminPending=Boolean(context.userId&&rows.length&&JSON.parse(rows[0].command).userId===context.userId);}catch{}
  }else adminPending=rows.length>0;
 }
 if(adminPending)return true;
 if(env.ENABLE_GROUP_APPROVAL==='true'&&context.userId){
  const action=await sql`SELECT user_id FROM group_access_action_challenges WHERE user_id=${context.userId}`;
  if(action.length)return true;
  const pending=await sql`SELECT user_id FROM group_access_challenges WHERE user_id=${context.userId}`;
  if(pending.length)return true;
 }
 return false;
}

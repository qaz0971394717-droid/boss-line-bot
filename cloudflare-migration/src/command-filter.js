import {createSql} from './database.js';
export const knownCommand=text=>/^(?:HELP|指令|進階指令|管理指令|群組ID|GROUPID|測試|TEST|RESTART|清除KB|王列表|BOSS列表|KB|王|BOSS|HALF(?:\s+(?:ON|OFF))?)$/i.test(text.trim())||/^(?:K|KBKILL|取消|修改出生|新增王|批次新增王|修改王|刪除王)\s+/i.test(text.trim());
export async function shouldProcessCommand(text,chatId,env,context){
 if(knownCommand(text)||(env.ENABLE_OPS_ALERTS==='true'&&text.trim()==='啟用異常通知'))return true;
 const sql=createSql(env);
 if(['是','否'].includes(text.trim())&&context.userId){
  const rows=await sql`SELECT expires_at FROM command_confirmations WHERE chat_id=${chatId} AND user_id=${context.userId}`;
  return rows.length>0;
 }
 // Retain the existing administrator password conversation. Ordinary chat has
 // at most an indexed read here; no event record or reply is written.
 if(env.ENABLE_STAGING_ADMIN==='true'){
  const rows=await sql`SELECT expires_at FROM staging_admin_challenges WHERE chat_id=${chatId}`;
  return rows.length>0;
 }
 return false;
}

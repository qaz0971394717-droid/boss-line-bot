// Isolated reminder transport. Staging never contacts the production reminder worker.
import { fetchWithTimeout } from "./http.js";
export function reminderPayload(chatId,bossName,respawnTime){
 return {chatId,bossKey:bossName.toLowerCase(),bossName,respawnAt:new Date(respawnTime).toISOString()};
}
export function cancelPayload(chatId,bossName){
 return {chatId,bossKey:bossName.toLowerCase()};
}
export async function stagingReminderRequest(env,path,payload,fetcher=fetch){
 if(env.STAGING_MODE!=="true"||env.ENABLE_STAGING_REMINDERS!=="true")return {sent:false,reason:"disabled"};
 if(!env.STAGING_REMINDER_WORKER_URL||!env.STAGING_REMINDER_API_KEY)return {sent:false,reason:"not-configured"};
 if(path!=="/schedule"&&path!=="/cancel")return {sent:false,reason:"invalid-path"};
 let target,production;
 try {
  target=new URL(env.STAGING_REMINDER_WORKER_URL);
  if(env.REMINDER_WORKER_URL)production=new URL(env.REMINDER_WORKER_URL);
 }catch{return {sent:false,reason:"invalid-url"};}
 if(target.protocol!=="https:"||target.username||target.password||target.search||target.hash)return {sent:false,reason:"invalid-url"};
 if(production&&target.origin===production.origin&&target.pathname.replace(/\/$/,"")===production.pathname.replace(/\/$/,""))return {sent:false,reason:"production-endpoint"};
 if(env.REMINDER_API_KEY&&env.REMINDER_API_KEY===env.STAGING_REMINDER_API_KEY)return {sent:false,reason:"production-key"};
 const endpoint=new URL(target.toString());
 endpoint.pathname=target.pathname.replace(/\/$/,"")+path;
 try{
  const res=await fetchWithTimeout(endpoint.toString(),{
   method:"POST",
   headers:{"Authorization":"Bearer "+env.STAGING_REMINDER_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify(payload)
  },fetcher);
  return {sent:res.ok,status:res.status};
 }catch(error){
  return {sent:false,reason:error?.name==="AbortError"?"timeout":"network-error"};
 }
}

export function reminderWarning(env,result,verb="更新"){
 if(env.ENABLE_STAGING_REMINDERS!=="true"||result?.sent)return "";
 const reason=result?.reason||(`HTTP ${result?.status??"unknown"}`);
 return `\n⚠️ BOSS 資料已儲存，但提醒${verb}失敗（${reason}）。請勿依賴本次提醒。`;
}

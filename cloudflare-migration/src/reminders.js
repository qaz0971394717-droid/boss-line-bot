// Isolated reminder transport. Staging never contacts the production reminder worker.
export function reminderPayload(chatId,bossName,respawnTime){
 return {chatId,bossKey:bossName.toLowerCase(),bossName,respawnAt:new Date(respawnTime).toISOString()};
}
export function cancelPayload(chatId,bossName){
 return {chatId,bossKey:bossName.toLowerCase()};
}
export async function stagingReminderRequest(env,path,payload,fetcher=fetch){
 if(env.STAGING_MODE!=="true"||env.ENABLE_STAGING_REMINDERS!=="true")return {sent:false,reason:"disabled"};
 if(!env.STAGING_REMINDER_WORKER_URL||!env.STAGING_REMINDER_API_KEY)return {sent:false,reason:"not-configured"};
 const target=new URL(env.STAGING_REMINDER_WORKER_URL);
 if(target.protocol!=="https:")return {sent:false,reason:"invalid-url"};
 const res=await fetcher(new URL(path,target).toString(),{
  method:"POST",
  headers:{"Authorization":"Bearer "+env.STAGING_REMINDER_API_KEY,"Content-Type":"application/json"},
  body:JSON.stringify(payload)
 });
 return {sent:res.ok,status:res.status};
}

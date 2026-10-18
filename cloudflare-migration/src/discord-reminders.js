// Reuse the existing Discord-only Durable Object and its own group mapping.
// No LINE push transport or Discord webhook credentials are introduced here.
export async function discordReminderRequest(env,path,payload){
 if(env.PRODUCTION_MODE!=='true'||env.ENABLE_DISCORD_REMINDERS!=='true')return {sent:false,reason:'disabled'};
 if(!env.DISCORD_REMINDER?.idFromName||!env.DISCORD_REMINDER?.get)return {sent:false,reason:'not-configured'};
 if(!['/schedule','/cancel'].includes(path))return {sent:false,reason:'invalid-path'};
 if(!payload?.chatId||typeof payload.bossKey!=='string'||!payload.bossKey)return {sent:false,reason:'invalid-payload'};
 if(path==='/schedule'&&(!payload.bossName||!Number.isFinite(Date.parse(payload.respawnAt))))return {sent:false,reason:'invalid-payload'};
 try{
  const stub=env.DISCORD_REMINDER.get(env.DISCORD_REMINDER.idFromName(payload.chatId+':'+payload.bossKey));
  const result=await (path==='/schedule'?stub.schedule(payload):stub.cancel());
  if(result?.ok&&result.skipped)return {sent:false,skipped:true,reason:'unmapped-group'};
  if(!result?.ok||(path==='/schedule'&&result.destination!=='discord'))return {sent:false,reason:'rejected'};
  return {sent:true,pending:result.pending};
 }catch{return {sent:false,reason:'discord-service-unavailable'};}
}

export async function syncFutureDiscordReminders(env,now=new Date()){
 if(env.PRODUCTION_MODE!=='true'||env.ENABLE_DISCORD_REMINDERS!=='true'||!env.BOSS_DB?.prepare)throw Error('Production Discord sync disabled');
 const rows=(await env.BOSS_DB.prepare('SELECT chat_id,boss_key,boss_name,respawn_time FROM boss_kills WHERE respawn_time>? ORDER BY respawn_time LIMIT 101').bind(now.toISOString()).all()).results;
 if(!rows||rows.length>100)throw Error('Sync batch exceeds safe limit');
 const totals={considered:rows.length,scheduled:0,skipped:0,failed:0,pending:0};
 for(let i=0;i<rows.length;i+=4){
  const outcomes=await Promise.all(rows.slice(i,i+4).map(row=>discordReminderRequest(env,'/schedule',{chatId:row.chat_id,bossKey:row.boss_key,bossName:row.boss_name,respawnAt:row.respawn_time})));
  for(const result of outcomes){if(result.skipped)totals.skipped++;else if(result.sent){totals.scheduled++;totals.pending+=Number(result.pending||0);}else totals.failed++;}
 }
 return totals;
}

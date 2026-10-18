import {syncFutureDiscordReminders} from "./discord-reminders.js";
import {BIRTHDAY_COMMAND,birthdayEnabled,birthdayGreeting,addBirthdayButton} from './birthday.js';
import {checkOverwrite,consumeOverwrite} from './overwrite-guard.js';
import {undoEnvironment} from './undo.js';
import {undoLast} from './undo.js';
import {createHelpFlex,createHelpText} from './help-flex.js';
// Staging-only LINE command engine. No production webhook is routed here yet.
// All database writes require an isolated STAGING_DATABASE_URL.
import { createSql, hasDatabase } from "./database.js";
import { createKbFlex } from "./flex.js";
import { processAdminCommand } from "./admin.js";
import { stagingReminderRequest, reminderPayload, cancelPayload, reminderWarning } from "./reminders.js";

export const getChatId = source => source?.groupId || source?.roomId || source?.userId || "unknown";
export const taipeiTime = date => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).map(x=>[x.type,x.value])); return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`; };
export const textMessage = text => ({type:"text",text});

export function parseKillTime(input, now = new Date()) {
  if (!/^\d{4}(\d{2})?$/.test(input)) return null;
  const hh=Number(input.slice(0,2)),mm=Number(input.slice(2,4)),ss=Number(input.slice(4,6)||0);
  if(hh>23||mm>59||ss>59) return null;
  const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const parsed=new Date(`${day}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}+08:00`);
  return Number.isNaN(parsed.getTime())?null:parsed;
}

export function parseRespawnTime(day,clock) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}(:\d{2})?$/.test(clock)) return null;
  const date=new Date(`${day}T${clock.length===5?clock+":00":clock}+08:00`);
  if(Number.isNaN(date.getTime()))return null;
  const check=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(date);
  return check===`${day} ${clock.length===5?clock+":00":clock}`?date:null;
}

export async function handleLineCommand(command, chatId, env, now=new Date(), context={}) {
 if(command.trim()===BIRTHDAY_COMMAND)return birthdayEnabled(env,chatId)?birthdayGreeting():null;
 const confirmation=await consumeOverwrite(command,chatId,env,context.userId);
 if(confirmation?.reply)return confirmation.reply;
 if(confirmation?.row){const p=confirmation.row;return handleLineCommand(p.command,chatId,undoEnvironment(env,p.command,chatId,context.userId),new Date(p.requested_at),{...context,overwriteVersion:p.expected_version});}
 const protectedReply=await checkOverwrite(command,chatId,env,now,context);
 if(protectedReply)return protectedReply;
 const reply=await runLineCommand(command,chatId,env,now,context);
 if(reply&&env.ENABLE_UNDO_BUTTON==='true'&&env.UNDO_OPERATION_ID&&context.userId){
  const result=await env.BOSS_DB.prepare('SELECT id FROM undo_entries WHERE chat_id=? AND user_id=? AND operation_id=? LIMIT 1').bind(chatId,context.userId,env.UNDO_OPERATION_ID).all();
  if(result.results?.length)reply.quickReply={items:[{type:'action',action:{type:'postback',label:'復原上一筆',data:'undo:'+env.UNDO_OPERATION_ID,displayText:'復原上一筆'}}]};
 }
 return reply;
}
async function runLineCommand(command, chatId, env, now=new Date(), context={}) {
  if(!hasDatabase(env)) return textMessage("❌ 測試資料庫尚未設定。");
  const sql=createSql(env);
  const input=command.trim(), upper=input.toUpperCase();
  const eventMs=Number.isFinite(context.eventTimestamp)?context.eventTimestamp:now.getTime();
  const ordered=env.DATABASE_BACKEND==='d1'&&env.ENABLE_EVENT_ORDER_GUARD==='true';
  let clearing=false;
  if(upper==='RESTART'||input==='清除KB'){
    if(!context.userId)return textMessage('❌ 無法確認操作身分，請稍後再試。');
    await sql`INSERT INTO command_confirmations(chat_id,user_id,expires_at) VALUES(${chatId},${context.userId},${new Date(now.getTime()+60000).toISOString()}) ON CONFLICT(chat_id,user_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`;
    return textMessage('是否清除目前KB紀錄？\n回覆「是」清除，60秒內有效。');
  }
  if((input==='是'||input==='否')&&context.userId){
    const pending=await sql`DELETE FROM command_confirmations WHERE chat_id=${chatId} AND user_id=${context.userId} RETURNING expires_at`;
    if(!pending.length)return null;
    if(input==='否')return textMessage('已取消清除。');
    if(new Date(pending[0].expires_at).getTime()<=now.getTime())return textMessage('確認已逾時，未清除。');
    clearing=true;
  }
  if(input==='復原')return undoLast(env,chatId,context.userId,context.undoOperationId);
  if(env.ENABLE_UNDO==='true'&&input.startsWith('取消 ')&&input.trim().split(/\s+/).length>6)return textMessage('測試版一次最多取消 5 隻王，以確保可完整復原。');
  const adminReply=clearing?null:await processAdminCommand(input,chatId,env,sql,now,context);
  if(adminReply)return adminReply;
  if(input==='同步提醒'){
    if(env.PRODUCTION_MODE!=='true'||env.ENABLE_DISCORD_REMINDERS!=='true')return textMessage('此環境未啟用 Discord 提醒。');
    try{const r=await syncFutureDiscordReminders(env,now,chatId);return textMessage(`✅ 已同步 ${r.scheduled} 筆 Discord 提醒。`+(r.skipped?'\n本群未綁定 Discord，已略過。':'')+(r.failed?'\n⚠️ 部分同步失敗，請稍後再試。':''));}
    catch{return textMessage('⚠️ 提醒同步失敗，請稍後再試。');}
  }
  if(input==="指令文字")return createHelpText('common',now);
  if(input==="進階指令文字")return createHelpText('advanced',now);
  if(input==="管理指令文字")return createHelpText('admin',now);
  if(input==="指令"||upper==="HELP")return createHelpFlex('common',now);
  if(input==="進階指令")return createHelpFlex('advanced',now);
  if(input==="管理指令")return createHelpFlex('admin',now);
  if(input==="群組ID"||upper==="GROUPID")return textMessage("🆔 目前聊天室 ID\n\n"+chatId);
  if(input==="測試"||upper==="TEST"){
    const rows=await sql`SELECT half_mode FROM chat_settings WHERE chat_id=${chatId}`;
    return textMessage("✅ BOSS Bot 正常運作！\n目前："+(rows[0]?.half_mode?"⚡ HALF 減半模式":"⏱️ 正常模式")+"\n資料庫："+(env.DATABASE_BACKEND==="d1"?"Cloudflare D1":"PostgreSQL")+"");
  }
  if(clearing){
    const deleted=await sql`DELETE FROM boss_kills WHERE chat_id=${chatId} RETURNING boss_name`;
    const warnings=[];
    for (const item of deleted){
      const result=await stagingReminderRequest(env, "/cancel", cancelPayload(chatId, item.boss_name));
      if(reminderWarning(env,result,"取消"))warnings.push(item.boss_name);
    }
    return textMessage(`✅ 已清除本群 ${deleted.length} 筆KB紀錄。`+(warnings.length?'\n⚠️ 部分提醒取消失敗，請留意舊提醒。':''));
  }
  if(input==="王列表"||upper==="BOSS列表"){
    const rows=await sql`SELECT boss_name,minutes FROM boss_types ORDER BY minutes ASC,boss_name ASC`;
    const groups={"H線":new Map(),"1線":new Map(),"其他":new Map()};
    for(const row of rows){
      const line=row.boss_name.toUpperCase().endsWith("H")?"H線":row.boss_name.endsWith("1")?"1線":"其他";
      const group=groups[line];const minutes=Number(row.minutes);
      if(!group.has(minutes))group.set(minutes,[]);group.get(minutes).push(row.boss_name);
    }
    const lines=["📋 BOSS 名單"];
    for(const [line,group] of Object.entries(groups)){
      if(!group.size)continue;lines.push("", "━━━━━━━━━━",`【${line}】`,"━━━━━━━━━━");
      for(const [minutes,names] of [...group].sort(([a],[b])=>a-b)){
        lines.push("",`〔${minutes%60===0?minutes/60+"小時":minutes+"分鐘"}〕`);
        for(let i=0;i<names.length;i+=5)lines.push(names.slice(i,i+5).join("、"));
      }
    }
    return textMessage(lines.join("\n").slice(0,4900));
  }
  if(upper==="KB"||input==="王"||upper==="BOSS"){
    const rows=await sql`SELECT boss_name, respawn_time FROM boss_kills WHERE chat_id=${chatId} ORDER BY respawn_time ASC`;
    if(upper==="KB")return addBirthdayButton(createKbFlex(rows),env,chatId);
    if(!rows.length)return textMessage("📋 目前沒有 BOSS 紀錄。");
    return textMessage(rows.map(r=>`⚔️ ${r.boss_name}　${taipeiTime(new Date(r.respawn_time))}`).join("\n"));
  }
  if(upper==="HALF"||upper==="HALF ON"||upper==="HALF OFF"){
    const rows=await sql`SELECT half_mode FROM chat_settings WHERE chat_id=${chatId}`;
    const enabled=upper==="HALF ON"?true:upper==="HALF OFF"?false:!Boolean(rows[0]?.half_mode);
    await sql`INSERT INTO chat_settings(chat_id,half_mode) VALUES(${chatId},${enabled}) ON CONFLICT(chat_id) DO UPDATE SET half_mode=EXCLUDED.half_mode`;
    return textMessage(enabled?"⚡ HALF 減半模式：已開啟":"⏱️ HALF 減半模式：已關閉");
  }
  if(upper.startsWith("KBKILL ")){
    const bossKey=input.slice(7).trim().toLowerCase();
    if(!bossKey)return textMessage("❌ 找不到這隻王，請重新輸入 KB。");
    const bosses=await sql`SELECT boss_name,minutes FROM boss_types WHERE boss_key=${bossKey}`;
    if(!bosses.length)return textMessage("❌ 找不到這隻王，請重新輸入 KB。");
    const current=await sql`SELECT boss_name FROM boss_kills WHERE chat_id=${chatId} AND boss_key=${bossKey}`;
    if(!current.length)return textMessage("❌ 這筆紀錄已不存在，請重新輸入 KB。");
    const half=await sql`SELECT half_mode FROM chat_settings WHERE chat_id=${chatId}`;
    const boss=bosses[0],respawn=new Date(now.getTime()+Number(boss.minutes)*60000*(half[0]?.half_mode?0.5:1));
    if(ordered){const changed=await sql`UPDATE boss_kills SET kill_time=${now.toISOString()},respawn_time=${respawn.toISOString()},last_event_ms=${eventMs} WHERE chat_id=${chatId} AND boss_key=${bossKey} AND last_event_ms<=${eventMs} RETURNING boss_name`;if(!changed.length)return textMessage('ℹ️ 已有較新的紀錄，未覆蓋。');}
    else await sql`UPDATE boss_kills SET kill_time=${now.toISOString()},respawn_time=${respawn.toISOString()} WHERE chat_id=${chatId} AND boss_key=${bossKey}`;
    const reminder=await stagingReminderRequest(env, "/schedule", reminderPayload(chatId, boss.boss_name, respawn));
    return textMessage(`✅ ${boss.boss_name} 擊殺已記錄｜下次出生 ${taipeiTime(respawn)}${reminderWarning(env,reminder,"排程")}`);
  }
  if(upper.startsWith("K ")){
    const parts=input.split(/\s+/);
    if(parts.length!==2&&parts.length!==3&&parts.length!==4)return textMessage("❌ K 王格式錯誤");
    const rows=await sql`SELECT boss_name, minutes FROM boss_types WHERE boss_key=${parts[1].toLowerCase()}`;
    if(!rows.length)return textMessage(`❌ 找不到 BOSS：${parts[1]}`);
    const clock=parts[3];
    const explicit=parts.length===4&&/^\d{4}(\d{2})?$/.test(clock)?parseRespawnTime(parts[2],`${clock.slice(0,2)}:${clock.slice(2,4)}:${clock.slice(4,6)||'00'}`):null;
    const kill=parts.length===4?explicit:parts.length===3?parseKillTime(parts[2],now):now;
    if(!kill)return textMessage("❌ 時間格式錯誤，請輸入 4 碼或 6 碼時間。");
    const half=await sql`SELECT half_mode FROM chat_settings WHERE chat_id=${chatId}`;
    const boss=rows[0],respawn=new Date(kill.getTime()+Number(boss.minutes)*60000*(half[0]?.half_mode?0.5:1));
    if(ordered){
      const changed=await sql`INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time,last_event_ms) VALUES(${chatId},${boss.boss_name.toLowerCase()},${boss.boss_name},${kill.toISOString()},${respawn.toISOString()},${eventMs}) ON CONFLICT(chat_id,boss_key) DO UPDATE SET boss_name=EXCLUDED.boss_name,kill_time=EXCLUDED.kill_time,respawn_time=EXCLUDED.respawn_time,last_event_ms=EXCLUDED.last_event_ms WHERE EXCLUDED.last_event_ms>=boss_kills.last_event_ms RETURNING boss_name`;
      if(!changed.length)return textMessage('ℹ️ 已有較新的紀錄，未覆蓋。');
    }else await sql`INSERT INTO boss_kills(chat_id,boss_key,boss_name,kill_time,respawn_time)
      VALUES(${chatId},${boss.boss_name.toLowerCase()},${boss.boss_name},${kill.toISOString()},${respawn.toISOString()})
      ON CONFLICT(chat_id,boss_key) DO UPDATE SET boss_name=EXCLUDED.boss_name,kill_time=EXCLUDED.kill_time,respawn_time=EXCLUDED.respawn_time`;
    const reminder=await stagingReminderRequest(env, "/schedule", reminderPayload(chatId, boss.boss_name, respawn));
    if(parts.length===4)return textMessage(`✅ ${boss.boss_name}｜擊殺 ${taipeiTime(kill)}｜出生 ${taipeiTime(respawn)}`);
    return textMessage(`✅ ${boss.boss_name} 擊殺已記錄｜下次出生 ${taipeiTime(respawn)}${reminderWarning(env,reminder,"排程")}`);
  }
  if(input.startsWith("取消 ")){
    const names=[...new Set(input.slice(3).trim().split(/\s+/).filter(Boolean))];
    if(!names.length)return textMessage("❌ 格式：取消 伐木H 時光H 山峰H");
    const removed=[],missing=[],noRecord=[],warningNames=[];
    for(const name of names){
      const boss=await sql`SELECT boss_name FROM boss_types WHERE boss_key=${name.toLowerCase()}`;
      if(!boss.length){missing.push(name);continue;}
      const result=await sql`DELETE FROM boss_kills WHERE chat_id=${chatId} AND boss_key=${name.toLowerCase()} RETURNING boss_name`;
      if(result.length){removed.push(result[0].boss_name);const reminder=await stagingReminderRequest(env, "/cancel", cancelPayload(chatId, result[0].boss_name));if(reminderWarning(env,reminder,"取消"))warningNames.push(result[0].boss_name);}else noRecord.push(boss[0].boss_name);
    }
    return textMessage([removed.length?`✅ 已取消 ${removed.length} 隻 BOSS：${removed.join(", ")}`:"",noRecord.length?`ℹ️ 無 K 王紀錄：${noRecord.join(", ")}`:"",missing.length?`❌ 找不到 BOSS：${missing.join(", ")}`:"",warningNames.length?`⚠️ 以下提醒取消失敗：${warningNames.join("、")}`:""].filter(Boolean).join("\n"));
  }
  if(input.startsWith("修改出生 ")){
    const parts=input.split(/\s+/);
    if(parts.length!==4)return textMessage("❌ 格式：修改出生 伐木H 2026-10-16 14:30:25");
    const time=parseRespawnTime(parts[2],parts[3]);
    if(!time)return textMessage("❌ 時間格式錯誤");
    const bosses=await sql`SELECT boss_name,minutes FROM boss_types WHERE boss_key=${parts[1].toLowerCase()}`;
    if(!bosses.length)return textMessage(`❌ 找不到 BOSS：${parts[1]}`);
    const half=await sql`SELECT half_mode FROM chat_settings WHERE chat_id=${chatId}`;
    const kill=new Date(time.getTime()-Number(bosses[0].minutes)*60000*(half[0]?.half_mode?0.5:1));
    const updated=ordered?await sql`UPDATE boss_kills SET kill_time=${kill.toISOString()},respawn_time=${time.toISOString()},last_event_ms=${eventMs} WHERE chat_id=${chatId} AND boss_key=${parts[1].toLowerCase()} AND last_event_ms<=${eventMs} RETURNING boss_name`:await sql`UPDATE boss_kills SET kill_time=${kill.toISOString()},respawn_time=${time.toISOString()} WHERE chat_id=${chatId} AND boss_key=${parts[1].toLowerCase()} RETURNING boss_name`;
    const reminder=updated.length?await stagingReminderRequest(env, "/schedule", reminderPayload(chatId, updated[0].boss_name, time)):null;
    if(ordered&&!updated.length){const current=await sql`SELECT last_event_ms FROM boss_kills WHERE chat_id=${chatId} AND boss_key=${parts[1].toLowerCase()}`;if(current[0]?.last_event_ms>eventMs)return textMessage('ℹ️ 已有較新的紀錄，未覆蓋。');}
    return textMessage(updated.length?`✅ ${updated[0].boss_name} 出生時間已改為 ${taipeiTime(time)}${reminderWarning(env,reminder,"排程")}`:`❌ ${bosses[0].boss_name} 尚無 K 王紀錄，請先記錄一次。`);
  }
  return textMessage("ℹ️ 不支援此指令，輸入「指令」查看。");
}

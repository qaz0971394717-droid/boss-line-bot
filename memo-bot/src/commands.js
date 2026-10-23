import {getNoticeMinutes,noticeLabel} from './notice.js';
import {linkCalendar,calendarStatus,addCalendarEvent,deleteCalendarAndMemo,setNoticeMinutes,calendarItems,previewCalendarClear,cancelCalendarClear,confirmCalendarClear} from './google.js';
import {parseReminder,taipeiDay,displayTime,calendarUrl,isReminderInput} from './calendar.js';
const text=value=>({type:'text',text:value});
const action=(label,value)=>({type:'action',action:{type:'message',label,text:value}});
const query=(db,s,...p)=>db.prepare(s).bind(...p);
export function normalizeMemoCommand(raw){
 const input=raw.trim();
 if(['今天有什麼事','今天要做什麼','今天行程','今天提醒'].includes(input))return '今天待辦';
 if(input==='備忘'||input==='筆記'||input==='我的筆記')return '備忘列表';
 if(/^(?:備忘列表|待辦)(?:\s+\d+)?$/.test(input))return input;
 const search=input.match(/^(?:查備忘|找筆記|查筆記|搜尋)[:：\s]*(.+)$/s);
 if(search)return '查備忘 '+search[1].trim();
 const note=input.match(/^(幫我記(?:一下|下|錄)?|記一下|記下|筆記|備忘|待辦)[:：\s]*(.+)$/s);
 if(note)return (note[1]==='待辦'?'待辦':'備忘')+' '+note[2].trim();
 return input;
}

export const knownCommand=input=>isReminderInput(input)||/^(指令|HELP|測試|日曆行程(?:\s+\d+)?|已結束行程(?:\s+\d+)?|清除日曆|清除已結束行程|刪除日曆\s+\d+|取消日曆清除|確認日曆清除\s+[a-f0-9]{32}|連結日曆|日曆狀態|加入日曆\s+\d+|提醒設定\s+\d+|自訂提醒\s+\d+|提前提醒\s+\d+\s+\d+|今天待辦|待辦(?:\s+\d+)?|備忘列表(?:\s+\d+)?|查備忘\s+.+|(?:查看|文字|完成|取消完成|刪除|確認刪除|連同日曆刪除|取消刪除)\s+\d+|(?:備忘|待辦)[:：\s].+|提醒\s+.+)$/is.test(normalizeMemoCommand(input));
const help=(googleReady=false)=>({
 ...text('📒 我的備忘\n\n📝 記事情\n備忘 買牛奶\n\n🔔 設提醒\n明天下午3點提醒我拿包裹\n\n📋 看待辦\n今天待辦\n\n🔎 找筆記\n查備忘 牛奶\n\n'+(googleReady?'提醒建立後，點「確認新增至日曆」。':'提醒建立後，點「加入 Google 日曆」並儲存。')),
 quickReply:{items:[action('今天待辦','今天待辦'),action('全部待辦','待辦'),action('我的筆記','備忘列表'),action('日曆行程','日曆行程')]}
});
export function itemCard(item,googleReady=false){
 const button=(label,command)=>({type:'button',height:'sm',style:'secondary',action:{type:'message',label,text:command}});
 const buttons=[];
 if(item.due_at&&item.status!=='done')buttons.push({type:'button',height:'sm',style:'primary',action:googleReady?{type:'postback',label:'確認新增至日曆',data:'memo:calendar:'+item.id,displayText:'確認新增日曆 #'+item.id}:{type:'uri',label:'加入 Google 日曆',uri:calendarUrl(item)}});
 if(item.due_at&&item.status!=='done'&&googleReady)buttons.push(button('提醒時間：'+noticeLabel(getNoticeMinutes(item)),`提醒設定 ${item.id}`));
 if(item.kind!=='note'&&item.kind!=='reminder')buttons.push(button(item.status==='done'?'重新待辦':'完成',`${item.status==='done'?'取消完成':'完成'} ${item.id}`));
 if(item.kind!=='reminder')buttons.push(button('電腦版可複製文字',`文字 ${item.id}`));
 buttons.push(button('刪除',`刪除 ${item.id}`));
 return {type:'flex',altText:`個人備忘 #${item.id} ${item.content.slice(0,60)}`,contents:{type:'bubble',size:'mega',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:`#${item.id} ${item.kind==='note'?'備忘':item.status==='done'?'已完成':'待辦'}`,weight:'bold',size:'md',color:'#334155'},{type:'text',text:item.content,wrap:true,size:'md'},...(item.due_at?[{type:'text',text:`時間：${displayTime(item.due_at)}（台灣）`,wrap:true,size:'sm'},{type:'text',text:googleReady?`通知：${displayTime(new Date(new Date(item.due_at).getTime()-getNoticeMinutes(item)*60000).toISOString())}（${noticeLabel(getNoticeMinutes(item))}）`:'日曆需另外按「儲存」，並確認通知設定；LINE 不會主動提醒，也不會同步日曆變更。',wrap:true,size:'xs',color:'#64748B'}]:[])]},footer:{type:'box',layout:'vertical',spacing:'sm',contents:buttons}}};
}
export async function runCommand(input,{db,owner,eventId,now=new Date(),env={},fetcher=fetch}){
 const googleReady=Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_KEY);
 input=normalizeMemoCommand(input);
 if(input==='連結日曆')return linkCalendar(env,owner);
 if(input==='日曆狀態')return calendarStatus({...env,MEMO_DB:db},owner);
 if(/^加入日曆 \d+$/.test(input))return addCalendarEvent({...env,MEMO_DB:db},owner,Number(input.split(' ')[1]),fetcher);
 const calendarList=input.match(/^(日曆行程|已結束行程)(?:\s+(\d+))?$/);
 if(calendarList)return calendarItems({...env,MEMO_DB:db},owner,calendarList[1]==='已結束行程',Number(calendarList[2]||1),fetcher);
 if(input==='清除日曆'||input==='清除已結束行程')return previewCalendarClear({...env,MEMO_DB:db},owner,input==='清除日曆'?'all':'ended',fetcher);
 const removeCalendar=input.match(/^刪除日曆\s+(\d+)$/);
 if(removeCalendar)return previewCalendarClear({...env,MEMO_DB:db},owner,Number(removeCalendar[1]),fetcher);
 if(input==='取消日曆清除')return cancelCalendarClear({...env,MEMO_DB:db},owner);
 const confirmClear=input.match(/^確認日曆清除\s+([a-f0-9]{32})$/);
 if(confirmClear)return confirmCalendarClear({...env,MEMO_DB:db},owner,confirmClear[1],fetcher);
 const noticeCommand=input.match(/^(提醒設定|自訂提醒|提前提醒)\s+(\d+)(?:\s+(\d+))?$/);
 if(noticeCommand){
  const [,verb,rawId,rawMinutes]=noticeCommand,id=Number(rawId);
  const item=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND id=? AND deleted_at IS NULL',owner,id).first();
  if(!item||!item.due_at)return text('找不到這筆提醒。');
  if(!googleReady)return text('請先完成 Google 日曆串接，再設定提前通知。');
  if(verb==='自訂提醒')return text('輸入「提前提醒 '+id+' 45」可設為提前45分鐘。\n0 表示準時，最多10080分鐘（7天）。');
  if(verb==='提前提醒'){
   if(rawMinutes===undefined)return text('請輸入「提前提醒 '+id+' 45」，或按提醒時間選項。');
   const result=await setNoticeMinutes({...env,MEMO_DB:db},owner,id,Number(rawMinutes),fetcher);
   if(!result.text.startsWith('✅'))return result;
   const updated=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND id=? AND deleted_at IS NULL',owner,id).first();
   const card=itemCard(updated,googleReady);
   card.contents.body.contents.push({type:'text',text:result.text,wrap:true,size:'xs',color:'#166534'});
   return card;
  }
  return {...text('#'+id+' '+item.content+'\n事項：'+displayTime(item.due_at)+'\n要提前多久提醒？'),quickReply:{items:[
   ...[0,10,30,60,1440].map(minutes=>({type:'action',action:{type:'postback',label:noticeLabel(minutes),data:'memo:notice:'+id+':'+minutes,displayText:'#'+id+' '+noticeLabel(minutes)}})),
   action('自訂分鐘','自訂提醒 '+id)
  ]}};
 }
 if(input==='指令'||input.toUpperCase()==='HELP')return help(googleReady);
 if(input==='測試')return text('✅ 個人備忘正常｜僅限本人私訊使用\n資料庫：Cloudflare D1\n提醒方式：手動加入 Google 日曆');
 const note=input.match(/^(備忘|待辦)[:：\s]+(.+)$/s);
 if(note&&!/^待辦\s+\d+$/.test(input)){
  const content=note[2].trim();if(!content||content.length>1000)return text('備忘或待辦請輸入 1～1000 個字。');
  const kind=note[1]==='備忘'?'note':'task';
  await query(db,'INSERT INTO memo_items(owner_id,kind,content,created_at,updated_at,source_event) VALUES(?,?,?,?,?,?) ON CONFLICT(source_event) DO NOTHING',owner,kind,content,now.toISOString(),now.toISOString(),eventId).run();
  const item=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND source_event=?',owner,eventId).first();return itemCard(item,googleReady);
 }
 if(isReminderInput(input)){
  const parsed=parseReminder(input,now);if(parsed.error)return text(parsed.error);
  await query(db,"INSERT INTO memo_items(owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,'reminder',?,?,?,?,?) ON CONFLICT(source_event) DO NOTHING",owner,parsed.content,parsed.dueAt,now.toISOString(),now.toISOString(),eventId).run();
  return itemCard(await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND source_event=?',owner,eventId).first(),googleReady);
 }
 const itemCommand=input.match(/^(查看|文字|完成|取消完成|刪除|確認刪除|連同日曆刪除|取消刪除)\s+(\d+)$/);
 if(itemCommand){
  const [,verb,rawId]=itemCommand,id=Number(rawId);
  const item=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND id=? AND deleted_at IS NULL',owner,id).first();if(!item)return text('找不到這筆紀錄。');
  if(verb==='查看')return itemCard(item,googleReady);
  if(verb==='文字')return text(`#${id}\n${item.content}${item.due_at?'\n時間：'+displayTime(item.due_at)+'（台灣）':''}`);
  if(verb==='取消刪除')return text('已取消刪除。');
  if(verb==='連同日曆刪除')return deleteCalendarAndMemo({...env,MEMO_DB:db},owner,id,fetcher);
  if(verb==='刪除'){
   const choices=[{type:'action',action:{type:'postback',label:'只刪備忘',data:'memo:delete:'+id,displayText:'只刪備忘 #'+id}}];
   if(item.due_at)choices.push({type:'action',action:{type:'postback',label:'備忘＋日曆一起刪',data:'memo:deleteboth:'+id,displayText:'備忘與日曆一起刪 #'+id}});
   choices.push(action('取消','取消刪除 '+id));
   return {...text('是否刪除 #'+id+'？'+(item.due_at?'\n請選擇只刪備忘，或連同機器人建立的日曆行程一起刪除。':'')),quickReply:{items:choices}};
  }
  if(verb==='確認刪除'){
   await query(db,'UPDATE memo_items SET deleted_at=?,updated_at=? WHERE owner_id=? AND id=? AND deleted_at IS NULL',now.toISOString(),now.toISOString(),owner,id).run();return text(`✅ 已刪除 #${id}。${item.due_at?'\n日曆行程保留。':''}`);
  }
  if(item.kind==='note')return text('這筆是備忘，無須標記完成。');
  const status=verb==='完成'?'done':'pending';await query(db,"UPDATE memo_items SET status=?,updated_at=?,completed_at=CASE WHEN ?='done' THEN COALESCE(completed_at,?) ELSE NULL END WHERE owner_id=? AND id=?",status,now.toISOString(),status,now.toISOString(),owner,id).run();
  return text(`✅ #${id} 已${status==='done'?'完成':'重新列入待辦'}。${item.due_at?'\n不會同步變更 Google 日曆。':''}`);
 }
 const list=input.match(/^(待辦|備忘列表)(?:\s+(\d+))?$/),search=input.match(/^查備忘\s+(.+)$/s);
 if(list||search||input==='今天待辦'){
  const page=Number(list?.[2]||1);if(page<1||page>1000)return text('頁碼無效。');
  let where='owner_id=? AND deleted_at IS NULL',params=[owner];
  if(search){where+=" AND content LIKE ? ESCAPE '\\'";params.push('%'+search[1].replace(/[\\%_]/g,'\\$&')+'%');}
  else if(list?.[1]==='備忘列表'){where+=" AND kind='note'";}
  else {where+=" AND kind IN ('task','reminder') AND status='pending'";if(input==='今天待辦'){where+=' AND (due_at IS NULL OR due_at<?)';params.push(new Date(taipeiDay(new Date(now.getTime()+86400000))+'T00:00:00+08:00').toISOString());}}
  const rows=(await query(db,`SELECT * FROM memo_items WHERE ${where} ORDER BY COALESCE(due_at,'9999'),id DESC LIMIT 9 OFFSET ?`,...params,(page-1)*8).all()).results;
  if(!rows.length)return text('📋 目前沒有符合的紀錄。');
  const visible=rows.slice(0,8),reply=text(visible.map(i=>`#${i.id} ${i.status==='done'?'✓ ':''}${i.content.slice(0,75)}${i.content.length>75?'…':''}${i.due_at?'\n  '+displayTime(i.due_at):''}`).join('\n\n')+'\n\n輸入「查看 編號」可開啟操作。'+(input==='今天待辦'?'\n含逾期與未指定日期的待辦。':''));
  reply.quickReply={items:visible.map(i=>action('查看 #'+i.id,'查看 '+i.id))};
  if(rows.length>8&&list)reply.quickReply.items.push(action('下一頁',`${list[1]} ${page+1}`));
  if(rows.length>8&&!list)reply.text+='\n符合資料較多，請縮小搜尋或輸入「待辦」分頁查看。';
  return reply;
 }
 return help(googleReady);
}

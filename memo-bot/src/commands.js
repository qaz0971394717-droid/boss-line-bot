import {linkCalendar,calendarStatus,addCalendarEvent,deleteCalendarAndMemo} from './google.js';
import {parseReminder,taipeiDay,displayTime,calendarUrl} from './calendar.js';
const text=value=>({type:'text',text:value});
const action=(label,value)=>({type:'action',action:{type:'message',label,text:value}});
const query=(db,s,...p)=>db.prepare(s).bind(...p);
export const knownCommand=input=>/^(指令|HELP|測試|連結日曆|日曆狀態|加入日曆\s+\d+|今天待辦|待辦(?:\s+\d+)?|備忘列表(?:\s+\d+)?|查備忘\s+.+|(?:查看|文字|完成|取消完成|刪除|確認刪除|連同日曆刪除|取消刪除)\s+\d+|(?:備忘|待辦)[:：\s].+|提醒\s+.+)$/is.test(input.trim());
const help=(googleReady=false)=>({
 ...text('📒 我的備忘\\n\\n📝 記事情\\n備忘 買牛奶\\n\\n🔔 設提醒\\n提醒 明天 15:00 拿包裹\\n\\n📋 看待辦\\n今天待辦\\n\\n🔎 找筆記\\n查備忘 牛奶\\n\\n'+(googleReady?'提醒建立後，點「確認新增至日曆」。':'提醒建立後，點「加入 Google 日曆」並儲存。')),
 quickReply:{items:[action('今天待辦','今天待辦'),action('全部待辦','待辦'),action('我的筆記','備忘列表')]}
});
export function itemCard(item,googleReady=false){
 const button=(label,command)=>({type:'button',height:'sm',style:'secondary',action:{type:'message',label,text:command}});
 const buttons=[];
 if(item.due_at&&item.status!=='done')buttons.push({type:'button',height:'sm',style:'primary',action:googleReady?{type:'postback',label:'確認新增至日曆',data:'memo:calendar:'+item.id,displayText:'確認新增日曆 #'+item.id}:{type:'uri',label:'加入 Google 日曆',uri:calendarUrl(item)}});
 if(item.kind!=='note'&&item.kind!=='reminder')buttons.push(button(item.status==='done'?'重新待辦':'完成',`${item.status==='done'?'取消完成':'完成'} ${item.id}`));
 if(item.kind!=='reminder')buttons.push(button('電腦版可複製文字',`文字 ${item.id}`));
 buttons.push(button('刪除',`刪除 ${item.id}`));
 return {type:'flex',altText:`個人備忘 #${item.id} ${item.content.slice(0,60)}`,contents:{type:'bubble',size:'mega',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:`#${item.id} ${item.kind==='note'?'備忘':item.status==='done'?'已完成':'待辦'}`,weight:'bold',size:'md',color:'#334155'},{type:'text',text:item.content,wrap:true,size:'md'},...(item.due_at?[{type:'text',text:`時間：${displayTime(item.due_at)}（台灣）`,wrap:true,size:'sm'},{type:'text',text:googleReady?'點確認即直接新增，提前 10 分鐘通知；刪除時可選擇是否一併移除日曆。':'日曆需另外按「儲存」，並確認通知設定；LINE 不會主動提醒，也不會同步日曆變更。',wrap:true,size:'xs',color:'#64748B'}]:[])]},footer:{type:'box',layout:'vertical',spacing:'sm',contents:buttons}}};
}
export async function runCommand(input,{db,owner,eventId,now=new Date(),env={},fetcher=fetch}){
 const googleReady=Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_KEY);
 input=input.trim();
 if(input==='連結日曆')return linkCalendar(env,owner);
 if(input==='日曆狀態')return calendarStatus({...env,MEMO_DB:db},owner);
 if(/^加入日曆 \d+$/.test(input))return addCalendarEvent({...env,MEMO_DB:db},owner,Number(input.split(' ')[1]),fetcher);
 if(input==='指令'||input.toUpperCase()==='HELP')return help(googleReady);
 if(input==='測試')return text('✅ 個人備忘正常｜僅限本人私訊使用\n資料庫：Cloudflare D1\n提醒方式：手動加入 Google 日曆');
 const note=input.match(/^(備忘|待辦)[:：\s]+(.+)$/s);
 if(note&&!/^待辦\s+\d+$/.test(input)){
  const content=note[2].trim();if(!content||content.length>1000)return text('備忘或待辦請輸入 1～1000 個字。');
  const kind=note[1]==='備忘'?'note':'task';
  await query(db,'INSERT INTO memo_items(owner_id,kind,content,created_at,updated_at,source_event) VALUES(?,?,?,?,?,?) ON CONFLICT(source_event) DO NOTHING',owner,kind,content,now.toISOString(),now.toISOString(),eventId).run();
  const item=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND source_event=?',owner,eventId).first();return itemCard(item,googleReady);
 }
 if(input.startsWith('提醒 ')){
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
  const status=verb==='完成'?'done':'pending';await query(db,'UPDATE memo_items SET status=?,updated_at=? WHERE owner_id=? AND id=?',status,now.toISOString(),owner,id).run();
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

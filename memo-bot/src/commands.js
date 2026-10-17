import {parseReminder,taipeiDay,displayTime,calendarUrl} from './calendar.js';
const text=value=>({type:'text',text:value});
const action=(label,value)=>({type:'action',action:{type:'message',label,text:value}});
const query=(db,s,...p)=>db.prepare(s).bind(...p);
export const knownCommand=input=>/^(指令|HELP|測試|今天待辦|待辦(?:\s+\d+)?|備忘列表(?:\s+\d+)?|查備忘\s+.+|(?:查看|文字|完成|取消完成|刪除|確認刪除)\s+\d+|(?:備忘|待辦)[:：\s].+|提醒\s+.+)$/is.test(input.trim());
const help=()=>text('📒 個人備忘\n\n備忘 DL380 主板 P11782-001\n待辦 買硬碟\n提醒 明天 15:00 帶硬碟\n提醒 2026-10-20 09:30 客戶維修\n\n今天待辦｜待辦｜備忘列表\n查備忘 關鍵字｜查看 編號\n完成 編號｜刪除 編號\n\n提醒需點「加入 Google 日曆」並儲存，通知由日曆負責。');
export function itemCard(item){
 const button=(label,command)=>({type:'button',height:'sm',style:'secondary',action:{type:'message',label,text:command}});
 const buttons=[];
 if(item.due_at&&item.status!=='done')buttons.push({type:'button',height:'sm',style:'primary',action:{type:'uri',label:'加入 Google 日曆',uri:calendarUrl(item)}});
 if(item.kind!=='note')buttons.push(button(item.status==='done'?'重新待辦':'完成',`${item.status==='done'?'取消完成':'完成'} ${item.id}`));
 buttons.push(button('電腦版可複製文字',`文字 ${item.id}`),button('刪除',`刪除 ${item.id}`));
 return {type:'flex',altText:`個人備忘 #${item.id} ${item.content.slice(0,60)}`,contents:{type:'bubble',size:'mega',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:`#${item.id} ${item.kind==='note'?'備忘':item.status==='done'?'已完成':'待辦'}`,weight:'bold',size:'md',color:'#334155'},{type:'text',text:item.content,wrap:true,size:'md'},...(item.due_at?[{type:'text',text:`時間：${displayTime(item.due_at)}（台灣）`,wrap:true,size:'sm'},{type:'text',text:'日曆需另外按「儲存」，並確認通知設定；LINE 不會主動提醒，也不會同步日曆變更。',wrap:true,size:'xs',color:'#64748B'}]:[])]},footer:{type:'box',layout:'vertical',spacing:'sm',contents:buttons}}};
}
export async function runCommand(input,{db,owner,eventId,now=new Date()}){
 input=input.trim();
 if(input==='指令'||input.toUpperCase()==='HELP')return help();
 if(input==='測試')return text('✅ 個人備忘正常｜僅限本人私訊使用\n資料庫：Cloudflare D1\n提醒方式：手動加入 Google 日曆');
 const note=input.match(/^(備忘|待辦)[:：\s]+(.+)$/s);
 if(note&&!/^待辦\s+\d+$/.test(input)){
  const content=note[2].trim();if(!content||content.length>1000)return text('備忘或待辦請輸入 1～1000 個字。');
  const kind=note[1]==='備忘'?'note':'task';
  await query(db,'INSERT INTO memo_items(owner_id,kind,content,created_at,updated_at,source_event) VALUES(?,?,?,?,?,?) ON CONFLICT(source_event) DO NOTHING',owner,kind,content,now.toISOString(),now.toISOString(),eventId).run();
  const item=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND source_event=?',owner,eventId).first();return itemCard(item);
 }
 if(input.startsWith('提醒 ')){
  const parsed=parseReminder(input,now);if(parsed.error)return text(parsed.error);
  await query(db,"INSERT INTO memo_items(owner_id,kind,content,due_at,created_at,updated_at,source_event) VALUES(?,'reminder',?,?,?,?,?) ON CONFLICT(source_event) DO NOTHING",owner,parsed.content,parsed.dueAt,now.toISOString(),now.toISOString(),eventId).run();
  return itemCard(await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND source_event=?',owner,eventId).first());
 }
 const itemCommand=input.match(/^(查看|文字|完成|取消完成|刪除|確認刪除)\s+(\d+)$/);
 if(itemCommand){
  const [,verb,rawId]=itemCommand,id=Number(rawId);
  const item=await query(db,'SELECT * FROM memo_items WHERE owner_id=? AND id=? AND deleted_at IS NULL',owner,id).first();if(!item)return text('找不到這筆紀錄。');
  if(verb==='查看')return itemCard(item);
  if(verb==='文字')return text(`#${id}\n${item.content}${item.due_at?'\n時間：'+displayTime(item.due_at)+'（台灣）':''}`);
  if(verb==='刪除')return {...text(`是否刪除 #${id}？${item.due_at?'\nGoogle 日曆中的事件需另外刪除。':''}`),quickReply:{items:[{type:'action',action:{type:'postback',label:'確認刪除',data:`memo:delete:${id}`,displayText:`確認刪除 #${id}`}},action('保留','查看 '+id)]}};
  if(verb==='確認刪除'){
   await query(db,'UPDATE memo_items SET deleted_at=?,updated_at=? WHERE owner_id=? AND id=? AND deleted_at IS NULL',now.toISOString(),now.toISOString(),owner,id).run();return text(`✅ 已刪除 #${id}。${item.due_at?'\n日曆事件需另外刪除。':''}`);
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
 return help();
}

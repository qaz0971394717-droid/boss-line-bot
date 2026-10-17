const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
export const taipeiDay=date=>dayFormat.format(date);
export const displayTime=date=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date));
export function parseReminder(input,now=new Date()){
 const match=input.match(/^提醒\s+(今天|明天|後天|\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+(.+)$/s);
 if(!match)return {error:'格式：提醒 明天 15:00 帶硬碟\n或：提醒 2026-10-20 09:30 客戶維修'};
 const [,day,h,m,raw]=match,content=raw.trim();
 if(content.length<1||content.length>150)return {error:'提醒事項請輸入 1～150 個字。'};
 const offset={今天:0,明天:1,後天:2}[day];
 const date=offset===undefined?day:taipeiDay(new Date(now.getTime()+offset*86400000));
 const stamp=`${date}T${h.padStart(2,'0')}:${m}:00+08:00`,due=new Date(stamp);
 if(Number(h)>23||Number(m)>59||!Number.isFinite(due.getTime())||taipeiDay(due)!==date)return {error:'日期或時間無效，請使用 YYYY-MM-DD HH:MM。'};
 if(due.getTime()<=now.getTime())return {error:'這個時間已經過了，請指定未來的日期與時間。'};
 return {content,dueAt:due.toISOString()};
}
export function calendarUrl(item){
 const start=new Date(item.due_at),end=new Date(start.getTime()+30*60000);
 const compact=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const url=new URL('https://calendar.google.com/calendar/render');
 url.search=new URLSearchParams({action:'TEMPLATE',text:item.content,dates:`${compact(start)}/${compact(end)}`,ctz:'Asia/Taipei',details:`個人備忘 #${item.id}。請確認日曆通知時間。LINE 與日曆不會自動同步修改或刪除。`}).toString();
 return url.href;
}

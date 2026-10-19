const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'});
export const taipeiDay=date=>dayFormat.format(date);
export const displayTime=date=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date));
const fullWidth=input=>input.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xFF10)).replace(/：/g,':').replace(/\u3000/g,' ');
const digits={零:0,〇:0,一:1,二:2,兩:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
function number(value){
 if(/^\d+$/.test(value))return Number(value);
 if(!value||!/^[零〇一二兩三四五六七八九十]+$/.test(value))return NaN;
 if(value.includes('十')){const p=value.split('十');if(p.length!==2||p.some(x=>x.length>1))return NaN;return (p[0]?digits[p[0]]:1)*10+(p[1]?digits[p[1]]:0);}
 return Number([...value].map(c=>digits[c]).join(''));
}
export function isReminderInput(input){
 const value=fullWidth(input.trim());
 if(/^今天(?:待辦|有什麼事|要做什麼|行程|提醒)$/.test(value))return false;
 return /^(?:提醒|今天|明天|後天|大後天|(?:這(?:個)?|本)(?:週|周|星期|禮拜)[一二三四五六日天1-7]|下(?:週|周|星期|禮拜)[一二三四五六日天1-7]|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}|\d{1,2}\/\d{1,2}|(?:半小時|[零〇一二兩三四五六七八九十\d]+\s*(?:分鐘|小時|分|天))\s*後)/.test(value);
}
const formatError=()=>({error:'可直接說：這禮拜四早上10點換記憶體\n或：明天下午3點拿包裹。也可用下週一、10/20等日期。'});
export function parseReminder(input,now=new Date()){
 let value=fullWidth(input.trim()).replace(/^提醒(?:我)?[\s:：]*/,'').trim();
 if(/^(?:每天|每週|每周|每月|每年)/.test(value))return {error:'目前支援單次提醒；重複提醒尚未開放。'};
 let due,content;
 const relative=value.match(/^(半小時|([零〇一二兩三四五六七八九十\d]+)\s*(分鐘|小時|分|天))\s*後\s*(?:提醒我|提醒)?[\s，,:：]*(.+)$/s);
 if(relative){
  const amount=relative[1]==='半小時'?30:number(relative[2]),unit=relative[3];
  const minutes=relative[1]==='半小時'?30:amount*(unit==='小時'?60:unit==='天'?1440:1);
  if(!Number.isFinite(minutes)||minutes<=0||minutes>525600)return {error:'請輸入 1 分鐘到 365 天內的提醒時間。'};
  due=new Date(now.getTime()+minutes*60000);content=relative[4].trim();
 }else{
  const today=taipeiDay(now),year=Number(today.slice(0,4));let date,rest,m;
  if((m=value.match(/^(今天|明天|後天|大後天)/))){
   date=taipeiDay(new Date(now.getTime()+({今天:0,明天:1,後天:2,大後天:3}[m[1]])*86400000));rest=value.slice(m[0].length);
  }else if((m=value.match(/^(?:這(?:個)?|本)(?:週|周|星期|禮拜)([一二三四五六日天1-7])/))){
   const target={一:1,二:2,三:3,四:4,五:5,六:6,日:7,天:7}[m[1]]||Number(m[1]);
   const anchor=new Date(today+'T00:00:00Z'),weekday=anchor.getUTCDay()||7;
   anchor.setUTCDate(anchor.getUTCDate()+target-weekday);date=anchor.toISOString().slice(0,10);rest=value.slice(m[0].length);
  }else if((m=value.match(/^下(?:週|周|星期|禮拜)([一二三四五六日天1-7])/))){
   const target={一:1,二:2,三:3,四:4,五:5,六:6,日:7,天:7}[m[1]]||Number(m[1]);
   const anchor=new Date(today+'T00:00:00Z'),weekday=anchor.getUTCDay()||7;
   anchor.setUTCDate(anchor.getUTCDate()+7-weekday+target);date=anchor.toISOString().slice(0,10);rest=value.slice(m[0].length);
  }else if((m=value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))){
   date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');rest=value.slice(m[0].length);
  }else if((m=value.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日號]?/))){
   date=(m[1]||year)+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');rest=value.slice(m[0].length);
  }else if((m=value.match(/^(\d{1,2})\/(\d{1,2})/))){
   date=year+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');rest=value.slice(m[0].length);
  }else return formatError();
  rest=rest.trim().replace(/^[，,]\s*/,'');
  const periodMatch=rest.match(/^(凌晨|早上|上午|中午|下午|傍晚|晚上|晚間|夜晚)\s*/);
  const period=periodMatch?.[1];if(periodMatch)rest=rest.slice(periodMatch[0].length);
  const clock=rest.match(/^(?:(\d{1,2}):(\d{1,2})|([零〇一二兩三四五六七八九十\d]{1,3})\s*[點点时時]\s*(?:(半)|(一刻|三刻)|([零〇一二兩三四五六七八九十]{1,3})分|(\d{1,2})\s*分?)?)/);
  if(!clock)return {error:'請補上時間，例如「明天下午3點 拿包裹」。'};
  let hour=number(clock[1]||clock[3]),minute=clock[2]!==undefined?Number(clock[2]):clock[4]?30:clock[5]==='一刻'?15:clock[5]==='三刻'?45:clock[6]?number(clock[6]):clock[7]?Number(clock[7]):0;
  const tail=rest.slice(clock[0].length);
  if(/^\s*[:：]\d/.test(tail))return {error:'目前時間支援到分鐘，請使用 15:30 或下午3點半。'};
  if(period){
   if(hour<0||hour>12||((period==='早上'||period==='上午')&&hour===12))return {error:'上午／下午請使用 1～12 點；中午用「中午12點」，午夜用「凌晨0點」。'};
   if(['下午','傍晚','晚上','晚間','夜晚'].includes(period)){if(hour===0||(['晚上','晚間','夜晚','傍晚'].includes(period)&&hour===12))return {error:'午夜請寫「凌晨0點」並確認日期；其他時間請使用 1～11 點。'};if(hour<12)hour+=12;}
   else if(period==='凌晨'){if(hour===12)hour=0;}
   else if(period==='中午'){if(hour===1||hour===2)hour+=12;else if(hour!==11&&hour!==12)return {error:'請把中午時間寫清楚，例如中午12點或下午3點。'};}
  }else if(clock[3]&&hour<=12)return {error:'請補上早上／下午，例如「明天下午3點」，避免把下午誤認為凌晨。'};
  if(hour>23||minute>59||!Number.isFinite(hour)||!Number.isFinite(minute))return {error:'日期或時間無效，請確認小時與分鐘。'};
  due=new Date(date+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+08:00');
  if(!Number.isFinite(due.getTime())||taipeiDay(due)!==date)return {error:'日期或時間無效，請確認月份與日期。'};
  content=tail.trim().replace(/^[，,:：]\s*/,'').replace(/^(?:請)?提醒(?:我)?\s*/,'').trim();
 }
 if(!content||content.length>150)return {error:'請輸入要提醒的事情，內容限 1～150 個字。'};
 if(due.getTime()<=now.getTime())return {error:'這個時間已經過了，請指定未來的日期與時間；跨年日期請加上年份。'};
 return {content,dueAt:due.toISOString()};
}

export function calendarUrl(item){
 const start=new Date(item.due_at),end=new Date(start.getTime()+30*60000);
 const compact=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const url=new URL('https://calendar.google.com/calendar/render');
 url.search=new URLSearchParams({action:'TEMPLATE',text:item.content,dates:`${compact(start)}/${compact(end)}`,ctz:'Asia/Taipei',details:`個人備忘 #${item.id}。請確認日曆通知時間。LINE 與日曆不會自動同步修改或刪除。`}).toString();
 return url.href;
}

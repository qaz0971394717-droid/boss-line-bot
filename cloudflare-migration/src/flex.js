// Pure LINE Flex builders. Data shape follows LINE Messaging API.
const tz="Asia/Taipei";
const SOON_MS=30*60*1000;
const parts=(date)=>Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:tz,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).map(p=>[p.type,p.value]));
const dateKey=date=>new Intl.DateTimeFormat("sv-SE",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const lineTime=date=>{const p=parts(date);return `${p.hour}:${p.minute}:${p.second}`;};
const shortTime=date=>{const p=parts(date);return `${p.hour}:${p.minute}`;};
const titleText=(text,color="#1E293B")=>({type:"text",text,size:"xs",weight:"bold",color});
// Row colours by status: already respawned, respawning within 30 minutes, later.
const STATUS={
 due:{name:"#B91C1C",bg:"#FEE2E2"},
 soon:{name:"#B45309",bg:"#FEF3C7"},
 later:{name:"#2563C5",bg:"#D9E8FC"}
};
const statusOf=ms=>ms<=0?"due":ms<=SOON_MS?"soon":"later";
export function createKbFlex(rows,now=new Date()){
 if(!rows.length)return {type:"text",text:"📋 目前沒有 BOSS 紀錄。\n\n現在記錄：K 大象H\n手動補登：K 大象H 1022"};
 const nowMs=now.getTime();
 const header={type:"box",layout:"vertical",backgroundColor:"#1E3A8A",paddingAll:"12px",contents:[
  {type:"box",layout:"horizontal",alignItems:"center",contents:[
   {type:"text",text:"⚔️ BOSS 重生表",size:"md",weight:"bold",color:"#FFFFFF",flex:1},
   {type:"text",text:`共 ${rows.length} 隻`,size:"xs",weight:"bold",color:"#BFDBFE",align:"end"}
  ]},
  {type:"text",text:`更新 ${shortTime(now)}　🔥已重生　⏰30分內`,size:"xxs",color:"#BFDBFE",margin:"xs"}
 ]};
 const cards=[];let contents=[],count=0;
 const flush=()=>{if(!contents.length)return;cards.push({type:"bubble",size:"mega",header:structuredClone(header),body:{type:"box",layout:"vertical",paddingAll:"12px",contents},footer:{type:"box",layout:"horizontal",contents:[titleText("時區: Asia/Taipei","#94A3B8"),{...titleText("","#94A3B8"),align:"end"}]}});contents=[];count=0;};
 const groups=new Map();
 for(const row of rows){const key=dateKey(new Date(row.respawn_time));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 for(const [date,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const weekday=new Intl.DateTimeFormat("zh-TW",{timeZone:tz,weekday:"short"}).format(new Date(items[0].respawn_time));
  const isToday=date===dateKey(now);
  if(contents.length&&count+items.length+1>15)flush();
  contents.push({type:"box",layout:"vertical",backgroundColor:"#E1E8F1",cornerRadius:"5px",paddingAll:"6px",margin:contents.length?"lg":"none",contents:[titleText(`📅 ${date.slice(5).replace("-","/")} ${weekday}${isToday?"（今天）":""}`)]});count++;
  for(const item of items){
   if(count>=15)flush();
   const respawn=new Date(item.respawn_time);
   const ms=respawn.getTime()-nowMs;
   const color=STATUS[statusOf(ms)];
   contents.push({type:"box",layout:"horizontal",margin:"md",spacing:"sm",alignItems:"center",contents:[
    {...titleText(lineTime(respawn),"#111827"),flex:3},
    {type:"box",layout:"vertical",flex:6,backgroundColor:color.bg,cornerRadius:"5px",paddingAll:"7px",contents:[{...titleText(String(item.boss_name),color.name),size:"sm"}]},
    {type:"box",layout:"vertical",flex:3,backgroundColor:"#2563C5",cornerRadius:"6px",paddingAll:"7px",justifyContent:"center",contents:[{type:"text",text:"⚔ K王",size:"xs",weight:"bold",color:"#FFFFFF",align:"center"}],action:{type:"postback",label:"⚔ K王",data:"kbkill:"+item.boss_name}}
   ]});count++;
  }
 }
 flush();
 for(let i=0;i<cards.length;i++)cards[i].footer.contents[1].text=`${i+1}/${cards.length}`;
 // LINE carousel supports at most 12 bubbles; caller should handle overflow explicitly.
 if(cards.length>12)return {type:"text",text:"❌ KB 卡片超過 LINE 單次顯示上限，請縮小查詢範圍。"};
 return {type:"flex",altText:"BOSS 重生時間表",contents:{type:"carousel",contents:cards}};
}
